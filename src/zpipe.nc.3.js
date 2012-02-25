var arguments_ = [];

var ENVIRONMENT_IS_NODE = typeof process === "object";

var ENVIRONMENT_IS_WEB = typeof window === "object";

var ENVIRONMENT_IS_WORKER = typeof importScripts === "function";

var ENVIRONMENT_IS_SHELL = !ENVIRONMENT_IS_WEB && !ENVIRONMENT_IS_NODE && !ENVIRONMENT_IS_WORKER;

if (ENVIRONMENT_IS_NODE) {
  print = (function(x) {
    process["stdout"].write(x + "\n");
  });
  printErr = (function(x) {
    process["stderr"].write(x + "\n");
  });
  var nodeFS = require("fs");
  read = (function(filename) {
    var ret = nodeFS["readFileSync"](filename).toString();
    if (!ret && filename[0] != "/") {
      filename = __dirname.split("/").slice(0, -1).join("/") + "/src/" + filename;
      ret = nodeFS["readFileSync"](filename).toString();
    }
    return ret;
  });
  arguments_ = process["argv"].slice(2);
} else if (ENVIRONMENT_IS_SHELL) {
  if (!this["read"]) {
    read = (function(f) {
      snarf(f);
    });
  }
  if (!this["arguments"]) {
    arguments_ = scriptArgs;
  } else {
    arguments_ = arguments;
  }
} else if (ENVIRONMENT_IS_WEB) {
  print = printErr = (function(x) {
    console.log(x);
  });
  read = (function(url) {
    var xhr = new XMLHttpRequest;
    xhr.open("GET", url, false);
    xhr.send(null);
    return xhr.responseText;
  });
  if (this["arguments"]) {
    arguments_ = arguments;
  }
} else if (ENVIRONMENT_IS_WORKER) {
  load = importScripts;
} else {
  throw "Unknown runtime environment. Where are we?";
}

function globalEval(x) {
  eval.call(null, x);
}

if (typeof load == "undefined" && typeof read != "undefined") {
  load = (function(f) {
    globalEval(read(f));
  });
}

if (typeof printErr === "undefined") {
  printErr = (function() {});
}

if (typeof print === "undefined") {
  print = printErr;
}

try {
  this["Module"] = Module;
} catch (e) {
  this["Module"] = Module = {};
}

if (!Module.arguments) {
  Module.arguments = arguments_;
}

if (Module.print) {
  print = Module.print;
}

var Runtime = {
  stackSave: (function() {
    return STACKTOP;
  }),
  stackRestore: (function(stackTop) {
    STACKTOP = stackTop;
  }),
  forceAlign: (function(target, quantum) {
    quantum = quantum || 4;
    if (quantum == 1) return target;
    if (isNumber(target) && isNumber(quantum)) {
      return Math.ceil(target / quantum) * quantum;
    } else if (isNumber(quantum) && isPowerOfTwo(quantum)) {
      var logg = log2(quantum);
      return "((((" + target + ")+" + (quantum - 1) + ")>>" + logg + ")<<" + logg + ")";
    }
    return "Math.ceil((" + target + ")/" + quantum + ")*" + quantum;
  }),
  isNumberType: (function(type) {
    return type in Runtime.INT_TYPES || type in Runtime.FLOAT_TYPES;
  }),
  isPointerType: function isPointerType(type) {
    return type[type.length - 1] == "*";
  },
  isStructType: function isStructType(type) {
    if (isPointerType(type)) return false;
    if (/^\[\d+\ x\ (.*)\]/.test(type)) return true;
    if (/<?{ [^}]* }>?/.test(type)) return true;
    return type[0] == "%";
  },
  INT_TYPES: {
    "i1": 0,
    "i8": 0,
    "i16": 0,
    "i32": 0,
    "i64": 0
  },
  FLOAT_TYPES: {
    "float": 0,
    "double": 0
  },
  bitshift64: (function(low, high, op, bits) {
    var ander = Math.pow(2, bits) - 1;
    if (bits < 32) {
      switch (op) {
       case "shl":
        return [ low << bits, high << bits | (low & ander << 32 - bits) >>> 32 - bits ];
       case "ashr":
        return [ (low >>> bits | (high & ander) << 32 - bits) >> 0 >>> 0, high >> bits >>> 0 ];
       case "lshr":
        return [ (low >>> bits | (high & ander) << 32 - bits) >>> 0, high >>> bits ];
      }
    } else if (bits == 32) {
      switch (op) {
       case "shl":
        return [ 0, low ];
       case "ashr":
        return [ high, (high | 0) < 0 ? ander : 0 ];
       case "lshr":
        return [ high, 0 ];
      }
    } else {
      switch (op) {
       case "shl":
        return [ 0, low << bits - 32 ];
       case "ashr":
        return [ high >> bits - 32 >>> 0, (high | 0) < 0 ? ander : 0 ];
       case "lshr":
        return [ high >>> bits - 32, 0 ];
      }
    }
    abort("unknown bitshift64 op: " + [ value, op, bits ]);
  }),
  or64: (function(x, y) {
    var l = x | 0 | (y | 0);
    var h = (Math.round(x / 4294967296) | Math.round(y / 4294967296)) * 4294967296;
    return l + h;
  }),
  and64: (function(x, y) {
    var l = (x | 0) & (y | 0);
    var h = (Math.round(x / 4294967296) & Math.round(y / 4294967296)) * 4294967296;
    return l + h;
  }),
  xor64: (function(x, y) {
    var l = (x | 0) ^ (y | 0);
    var h = (Math.round(x / 4294967296) ^ Math.round(y / 4294967296)) * 4294967296;
    return l + h;
  }),
  getNativeTypeSize: (function(type, quantumSize) {
    if (Runtime.QUANTUM_SIZE == 1) return 1;
    var size = {
      "%i1": 1,
      "%i8": 1,
      "%i16": 2,
      "%i32": 4,
      "%i64": 8,
      "%float": 4,
      "%double": 8
    }["%" + type];
    if (!size) {
      if (type[type.length - 1] == "*") {
        size = Runtime.QUANTUM_SIZE;
      } else if (type[0] == "i") {
        var bits = parseInt(type.substr(1));
        assert(bits % 8 == 0);
        size = bits / 8;
      }
    }
    return size;
  }),
  getNativeFieldSize: (function(type) {
    return Math.max(Runtime.getNativeTypeSize(type), Runtime.QUANTUM_SIZE);
  }),
  dedup: function dedup(items, ident) {
    var seen = {};
    if (ident) {
      return items.filter((function(item) {
        if (seen[item[ident]]) return false;
        seen[item[ident]] = true;
        return true;
      }));
    } else {
      return items.filter((function(item) {
        if (seen[item]) return false;
        seen[item] = true;
        return true;
      }));
    }
  },
  set: function set() {
    var args = typeof arguments[0] === "object" ? arguments[0] : arguments;
    var ret = {};
    for (var i = 0; i < args.length; i++) {
      ret[args[i]] = 0;
    }
    return ret;
  },
  calculateStructAlignment: function calculateStructAlignment(type) {
    type.flatSize = 0;
    type.alignSize = 0;
    var diffs = [];
    var prev = -1;
    type.flatIndexes = type.fields.map((function(field) {
      var size, alignSize;
      if (Runtime.isNumberType(field) || Runtime.isPointerType(field)) {
        size = Runtime.getNativeTypeSize(field);
        alignSize = size;
      } else if (Runtime.isStructType(field)) {
        size = Types.types[field].flatSize;
        alignSize = Types.types[field].alignSize;
      } else {
        throw "Unclear type in struct: " + field + ", in " + type.name_ + " :: " + dump(Types.types[type.name_]);
      }
      alignSize = type.packed ? 1 : Math.min(alignSize, Runtime.QUANTUM_SIZE);
      type.alignSize = Math.max(type.alignSize, alignSize);
      var curr = Runtime.alignMemory(type.flatSize, alignSize);
      type.flatSize = curr + size;
      if (prev >= 0) {
        diffs.push(curr - prev);
      }
      prev = curr;
      return curr;
    }));
    type.flatSize = Runtime.alignMemory(type.flatSize, type.alignSize);
    if (diffs.length == 0) {
      type.flatFactor = type.flatSize;
    } else if (Runtime.dedup(diffs).length == 1) {
      type.flatFactor = diffs[0];
    }
    type.needsFlattening = type.flatFactor != 1;
    return type.flatIndexes;
  },
  generateStructInfo: (function(struct, typeName, offset) {
    var type, alignment;
    if (typeName) {
      offset = offset || 0;
      type = (typeof Types === "undefined" ? Runtime.typeInfo : Types.types)[typeName];
      if (!type) return null;
      assert(type.fields.length === struct.length, "Number of named fields must match the type for " + typeName);
      alignment = type.flatIndexes;
    } else {
      var type = {
        fields: struct.map((function(item) {
          return item[0];
        }))
      };
      alignment = Runtime.calculateStructAlignment(type);
    }
    var ret = {
      __size__: type.flatSize
    };
    if (typeName) {
      struct.forEach((function(item, i) {
        if (typeof item === "string") {
          ret[item] = alignment[i] + offset;
        } else {
          var key;
          for (var k in item) key = k;
          ret[key] = Runtime.generateStructInfo(item[key], type.fields[i], alignment[i]);
        }
      }));
    } else {
      struct.forEach((function(item, i) {
        ret[item[1]] = alignment[i];
      }));
    }
    return ret;
  }),
  stackAlloc: function stackAlloc(size) {
    var ret = STACKTOP;
    STACKTOP += size;
    STACKTOP = STACKTOP + 3 >> 2 << 2;
    return ret;
  },
  staticAlloc: function staticAlloc(size) {
    var ret = STATICTOP;
    STATICTOP += size;
    STATICTOP = STATICTOP + 3 >> 2 << 2;
    if (STATICTOP >= TOTAL_MEMORY) enlargeMemory();
    return ret;
  },
  alignMemory: function alignMemory(size, quantum) {
    var ret = size = Math.ceil(size / (quantum ? quantum : 4)) * (quantum ? quantum : 4);
    return ret;
  },
  makeBigInt: function makeBigInt(low, high, unsigned) {
    var ret = unsigned ? (low >>> 0) + (high >>> 0) * 4294967296 : (low >>> 0) + (high | 0) * 4294967296;
    return ret;
  },
  QUANTUM_SIZE: 4,
  __dummy__: 0
};

var CorrectionsMonitor = {
  MAX_ALLOWED: 0,
  corrections: 0,
  sigs: {},
  note: (function(type, succeed, sig) {
    if (!succeed) {
      this.corrections++;
      if (this.corrections >= this.MAX_ALLOWED) abort("\n\nToo many corrections!");
    }
  }),
  print: (function() {})
};

var __THREW__ = false;

var ABORT = false;

var undef = 0;

var tempValue, tempInt, tempBigInt, tempInt2, tempBigInt2, tempPair, tempBigIntI, tempBigIntR, tempBigIntS, tempBigIntP, tempBigIntD;

var tempI64, tempI64b;

function abort(text) {
  print(text + ":\n" + (new Error).stack);
  ABORT = true;
  throw "Assertion: " + text;
}

function assert(condition, text) {
  if (!condition) {
    abort("Assertion failed: " + text);
  }
}

var globalScope = this;

function ccall(ident, returnType, argTypes, args) {
  function toC(value, type) {
    if (type == "string") {
      var ret = STACKTOP;
      Runtime.stackAlloc(value.length + 1);
      writeStringToMemory(value, ret);
      return ret;
    }
    return value;
  }
  function fromC(value, type) {
    if (type == "string") {
      return Pointer_stringify(value);
    }
    return value;
  }
  try {
    var func = eval("_" + ident);
  } catch (e) {
    try {
      func = globalScope["Module"]["_" + ident];
    } catch (e) {}
  }
  assert(func, "Cannot call unknown function " + ident + " (perhaps LLVM optimizations or closure removed it?)");
  var i = 0;
  var cArgs = args ? args.map((function(arg) {
    return toC(arg, argTypes[i++]);
  })) : [];
  return fromC(func.apply(null, cArgs), returnType);
}

Module["ccall"] = ccall;

function cwrap(ident, returnType, argTypes) {
  return (function() {
    return ccall(ident, returnType, argTypes, Array.prototype.slice.call(arguments));
  });
}

function setValue(ptr, value, type, noSafe) {
  type = type || "i8";
  if (type[type.length - 1] === "*") type = "i32";
  switch (type) {
   case "i1":
    HEAP8[ptr] = value;
    break;
   case "i8":
    HEAP8[ptr] = value;
    break;
   case "i16":
    HEAP16[ptr >> 1] = value;
    break;
   case "i32":
    HEAP32[ptr >> 2] = value;
    break;
   case "i64":
    HEAP32[ptr >> 2] = value;
    break;
   case "float":
    HEAPF32[ptr >> 2] = value;
    break;
   case "double":
    HEAPF32[ptr >> 2] = value;
    break;
   default:
    abort("invalid type for setValue: " + type);
  }
}

Module["setValue"] = setValue;

function getValue(ptr, type, noSafe) {
  type = type || "i8";
  if (type[type.length - 1] === "*") type = "i32";
  switch (type) {
   case "i1":
    return HEAP8[ptr];
   case "i8":
    return HEAP8[ptr];
   case "i16":
    return HEAP16[ptr >> 1];
   case "i32":
    return HEAP32[ptr >> 2];
   case "i64":
    return HEAP32[ptr >> 2];
   case "float":
    return HEAPF32[ptr >> 2];
   case "double":
    return HEAPF32[ptr >> 2];
   default:
    abort("invalid type for setValue: " + type);
  }
  return null;
}

Module["getValue"] = getValue;

var ALLOC_NORMAL = 0;

var ALLOC_STACK = 1;

var ALLOC_STATIC = 2;

Module["ALLOC_NORMAL"] = ALLOC_NORMAL;

Module["ALLOC_STACK"] = ALLOC_STACK;

Module["ALLOC_STATIC"] = ALLOC_STATIC;

function allocate(slab, types, allocator) {
  var zeroinit, size;
  if (typeof slab === "number") {
    zeroinit = true;
    size = slab;
  } else {
    zeroinit = false;
    size = slab.length;
  }
  var singleType = typeof types === "string" ? types : null;
  var ret = [ _malloc, Runtime.stackAlloc, Runtime.staticAlloc ][allocator === undefined ? ALLOC_STATIC : allocator](Math.max(size, singleType ? 1 : types.length));
  if (zeroinit) {
    _memset(ret, 0, size);
    return ret;
  }
  var i = 0, type;
  while (i < size) {
    var curr = slab[i];
    if (typeof curr === "function") {
      curr = Runtime.getFunctionIndex(curr);
    }
    type = singleType || types[i];
    if (type === 0) {
      i++;
      continue;
    }
    if (type == "i64") type = "i32";
    setValue(ret + i, curr, type);
    i += Runtime.getNativeTypeSize(type);
  }
  return ret;
}

Module["allocate"] = allocate;

function Pointer_stringify(ptr, length) {
  var nullTerminated = typeof length == "undefined";
  var ret = "";
  var i = 0;
  var t;
  var nullByte = String.fromCharCode(0);
  while (1) {
    t = String.fromCharCode(HEAPU8[ptr + i]);
    if (nullTerminated && t == nullByte) {
      break;
    } else {}
    ret += t;
    i += 1;
    if (!nullTerminated && i == length) {
      break;
    }
  }
  return ret;
}

Module["Pointer_stringify"] = Pointer_stringify;

function Array_stringify(array) {
  var ret = "";
  for (var i = 0; i < array.length; i++) {
    ret += String.fromCharCode(array[i]);
  }
  return ret;
}

Module["Array_stringify"] = Array_stringify;

var FUNCTION_TABLE;

var PAGE_SIZE = 4096;

function alignMemoryPage(x) {
  return Math.ceil(x / PAGE_SIZE) * PAGE_SIZE;
}

var HEAP;

var HEAP8, HEAPU8, HEAP16, HEAPU16, HEAP32, HEAPU32, HEAPF32;

var STACK_ROOT, STACKTOP, STACK_MAX;

var STATICTOP;

function enlargeMemory() {
  while (TOTAL_MEMORY <= STATICTOP) {
    TOTAL_MEMORY = alignMemoryPage(2 * TOTAL_MEMORY);
  }
  var oldHEAP8 = HEAP8;
  var buffer = new ArrayBuffer(TOTAL_MEMORY);
  HEAP8 = new Int8Array(buffer);
  HEAP16 = new Int16Array(buffer);
  HEAP32 = new Int32Array(buffer);
  HEAPU8 = new Uint8Array(buffer);
  HEAPU16 = new Uint16Array(buffer);
  HEAPU32 = new Uint32Array(buffer);
  HEAPF32 = new Float32Array(buffer);
  HEAP8.set(oldHEAP8);
}

var TOTAL_STACK = Module["TOTAL_STACK"] || 5242880;

var TOTAL_MEMORY = Module["TOTAL_MEMORY"] || 10485760;

var FAST_MEMORY = Module["FAST_MEMORY"] || 2097152;

assert(!!Int32Array && !!Float64Array && !!(new Int32Array(1))["subarray"] && !!(new Int32Array(1))["set"], "Cannot fallback to non-typed array case: Code is too specialized");

var buffer = new ArrayBuffer(TOTAL_MEMORY);

HEAP8 = new Int8Array(buffer);

HEAP16 = new Int16Array(buffer);

HEAP32 = new Int32Array(buffer);

HEAPU8 = new Uint8Array(buffer);

HEAPU16 = new Uint16Array(buffer);

HEAPU32 = new Uint32Array(buffer);

HEAPF32 = new Float32Array(buffer);

HEAP32[0] = 255;

assert(HEAPU8[0] === 255 && HEAPU8[3] === 0, "Typed arrays 2 must be run on a little-endian system");

var base = intArrayFromString("(null)");

STATICTOP = base.length;

for (var i = 0; i < base.length; i++) {
  HEAP8[i] = base[i];
}

Module["HEAP"] = HEAP;

Module["HEAP8"] = HEAP8;

Module["HEAP16"] = HEAP16;

Module["HEAP32"] = HEAP32;

Module["HEAPU8"] = HEAPU8;

Module["HEAPU16"] = HEAPU16;

Module["HEAPU32"] = HEAPU32;

Module["HEAPF32"] = HEAPF32;

STACK_ROOT = STACKTOP = Runtime.alignMemory(STATICTOP);

STACK_MAX = STACK_ROOT + TOTAL_STACK;

var tempDoublePtr = Runtime.alignMemory(STACK_MAX, 8);

var tempDoubleI8 = HEAP8.subarray(tempDoublePtr);

var tempDoubleI32 = HEAP32.subarray(tempDoublePtr >> 2);

var tempDoubleF32 = HEAPF32.subarray(tempDoublePtr >> 2);

var tempDoubleF64 = (new Float64Array(HEAP8.buffer)).subarray(tempDoublePtr >> 3);

function copyTempFloat(ptr) {
  tempDoubleI8[0] = HEAP8[ptr];
  tempDoubleI8[1] = HEAP8[ptr + 1];
  tempDoubleI8[2] = HEAP8[ptr + 2];
  tempDoubleI8[3] = HEAP8[ptr + 3];
}

function copyTempDouble(ptr) {
  tempDoubleI8[0] = HEAP8[ptr];
  tempDoubleI8[1] = HEAP8[ptr + 1];
  tempDoubleI8[2] = HEAP8[ptr + 2];
  tempDoubleI8[3] = HEAP8[ptr + 3];
  tempDoubleI8[4] = HEAP8[ptr + 4];
  tempDoubleI8[5] = HEAP8[ptr + 5];
  tempDoubleI8[6] = HEAP8[ptr + 6];
  tempDoubleI8[7] = HEAP8[ptr + 7];
}

STACK_MAX = tempDoublePtr + 8;

STATICTOP = alignMemoryPage(STACK_MAX);

function callRuntimeCallbacks(callbacks) {
  while (callbacks.length > 0) {
    var callback = callbacks.shift();
    var func = callback.func;
    if (typeof func === "number") {
      func = FUNCTION_TABLE[func];
    }
    func(callback.arg === undefined ? null : callback.arg);
  }
}

var __ATINIT__ = [];

var __ATEXIT__ = [];

function initRuntime() {
  callRuntimeCallbacks(__ATINIT__);
}

function exitRuntime() {
  callRuntimeCallbacks(__ATEXIT__);
  CorrectionsMonitor.print();
}

function Array_copy(ptr, num) {
  return Array.prototype.slice.call(HEAP8.subarray(ptr, ptr + num));
  return HEAP.slice(ptr, ptr + num);
}

Module["Array_copy"] = Array_copy;

function TypedArray_copy(ptr, num) {
  var arr = new Uint8Array(num);
  for (var i = 0; i < num; ++i) {
    arr[i] = HEAP8[ptr + i];
  }
  return arr.buffer;
}

Module["TypedArray_copy"] = TypedArray_copy;

function String_len(ptr) {
  var i = 0;
  while (HEAP8[ptr + i]) i++;
  return i;
}

Module["String_len"] = String_len;

function String_copy(ptr, addZero) {
  var len = String_len(ptr);
  if (addZero) len++;
  var ret = Array_copy(ptr, len);
  if (addZero) ret[len - 1] = 0;
  return ret;
}

Module["String_copy"] = String_copy;

function intArrayFromString(stringy, dontAddNull) {
  var ret = [];
  var t;
  var i = 0;
  while (i < stringy.length) {
    var chr = stringy.charCodeAt(i);
    if (chr > 255) {
      chr &= 255;
    }
    ret.push(chr);
    i = i + 1;
  }
  if (!dontAddNull) {
    ret.push(0);
  }
  return ret;
}

Module["intArrayFromString"] = intArrayFromString;

function intArrayToString(array) {
  var ret = [];
  for (var i = 0; i < array.length; i++) {
    var chr = array[i];
    if (chr > 255) {
      chr &= 255;
    }
    ret.push(String.fromCharCode(chr));
  }
  return ret.join("");
}

Module["intArrayToString"] = intArrayToString;

function writeStringToMemory(string, buffer, dontAddNull) {
  var i = 0;
  while (i < string.length) {
    var chr = string.charCodeAt(i);
    if (chr > 255) {
      chr &= 255;
    }
    HEAP8[buffer + i] = chr;
    i = i + 1;
  }
  if (!dontAddNull) {
    HEAP8[buffer + i] = 0;
  }
}

Module["writeStringToMemory"] = writeStringToMemory;

var STRING_TABLE = [];

function unSign(value, bits, ignore, sig) {
  if (value >= 0) {
    return value;
  }
  return bits <= 32 ? 2 * Math.abs(1 << bits - 1) + value : Math.pow(2, bits) + value;
}

function reSign(value, bits, ignore, sig) {
  if (value <= 0) {
    return value;
  }
  var half = bits <= 32 ? Math.abs(1 << bits - 1) : Math.pow(2, bits - 1);
  if (value >= half && (bits <= 32 || value > half)) {
    value = -2 * half + value;
  }
  return value;
}

function _malloc($bytes) {
  var __label__;
  var $cmp = $bytes < 245;
  do {
    if ($cmp) {
      if ($bytes < 11) {
        var $cond = 16;
      } else {
        var $cond = $bytes + 11 & -8;
      }
      var $cond;
      var $shr = $cond >>> 3;
      var $0 = HEAPU32[__gm_ >> 2];
      var $shr3 = $0 >>> $shr;
      if (($shr3 & 3) != 0) {
        var $add8 = ($shr3 & 1 ^ 1) + $shr;
        var $shl = $add8 << 1;
        var $1 = ($shl << 2) + __gm_ + 40;
        var $2 = ($shl + 2 << 2) + __gm_ + 40;
        var $3 = HEAPU32[$2 >> 2];
        var $fd9 = $3 + 8;
        var $4 = HEAPU32[$fd9 >> 2];
        if ($1 == $4) {
          HEAP32[__gm_ >> 2] = $0 & (1 << $add8 ^ -1);
        } else {
          if ($4 < HEAPU32[__gm_ + 16 >> 2]) {
            _abort();
            throw "Reached an unreachable!";
          } else {
            HEAP32[$2 >> 2] = $4;
            HEAP32[$4 + 12 >> 2] = $1;
          }
        }
        var $shl20 = $add8 << 3;
        HEAP32[$3 + 4 >> 2] = $shl20 | 3;
        var $8 = $3 + ($shl20 | 4);
        var $or24 = HEAP32[$8 >> 2] | 1;
        HEAP32[$8 >> 2] = $or24;
        var $mem_0 = $fd9;
        __label__ = 37;
        break;
      }
      if ($cond <= HEAPU32[__gm_ + 8 >> 2]) {
        var $nb_0 = $cond;
        __label__ = 29;
        break;
      }
      if ($shr3 != 0) {
        var $shl37 = 2 << $shr;
        var $and41 = $shr3 << $shr & ($shl37 | -$shl37);
        var $sub44 = ($and41 & -$and41) - 1;
        var $and46 = $sub44 >>> 12 & 16;
        var $shr47 = $sub44 >>> $and46;
        var $and49 = $shr47 >>> 5 & 8;
        var $shr51 = $shr47 >>> $and49;
        var $and53 = $shr51 >>> 2 & 4;
        var $shr55 = $shr51 >>> $and53;
        var $and57 = $shr55 >>> 1 & 2;
        var $shr59 = $shr55 >>> $and57;
        var $and61 = $shr59 >>> 1 & 1;
        var $add64 = ($and49 | $and46 | $and53 | $and57 | $and61) + ($shr59 >>> $and61);
        var $shl65 = $add64 << 1;
        var $12 = ($shl65 << 2) + __gm_ + 40;
        var $13 = ($shl65 + 2 << 2) + __gm_ + 40;
        var $14 = HEAPU32[$13 >> 2];
        var $fd69 = $14 + 8;
        var $15 = HEAPU32[$fd69 >> 2];
        if ($12 == $15) {
          HEAP32[__gm_ >> 2] = $0 & (1 << $add64 ^ -1);
        } else {
          if ($15 < HEAPU32[__gm_ + 16 >> 2]) {
            _abort();
            throw "Reached an unreachable!";
          } else {
            HEAP32[$13 >> 2] = $15;
            HEAP32[$15 + 12 >> 2] = $12;
          }
        }
        var $shl87 = $add64 << 3;
        var $sub88 = $shl87 - $cond;
        HEAP32[$14 + 4 >> 2] = $cond | 3;
        var $18 = $14;
        var $19 = $18 + $cond;
        HEAP32[$18 + ($cond | 4) >> 2] = $sub88 | 1;
        HEAP32[$18 + $shl87 >> 2] = $sub88;
        var $21 = HEAPU32[__gm_ + 8 >> 2];
        if ($21 != 0) {
          var $22 = HEAP32[__gm_ + 20 >> 2];
          var $shl100 = $21 >>> 2 & 1073741822;
          var $24 = ($shl100 << 2) + __gm_ + 40;
          var $25 = HEAPU32[__gm_ >> 2];
          var $shl103 = 1 << ($21 >>> 3);
          var $tobool105 = ($25 & $shl103) == 0;
          do {
            if ($tobool105) {
              HEAP32[__gm_ >> 2] = $25 | $shl103;
              var $F102_0 = $24;
              var $_pre_phi = ($shl100 + 2 << 2) + __gm_ + 40;
            } else {
              var $26 = ($shl100 + 2 << 2) + __gm_ + 40;
              var $27 = HEAPU32[$26 >> 2];
              if ($27 >= HEAPU32[__gm_ + 16 >> 2]) {
                var $F102_0 = $27;
                var $_pre_phi = $26;
                break;
              }
              _abort();
              throw "Reached an unreachable!";
            }
          } while (0);
          var $_pre_phi;
          var $F102_0;
          HEAP32[$_pre_phi >> 2] = $22;
          HEAP32[$F102_0 + 12 >> 2] = $22;
          var $fd122 = $22 + 8;
          HEAP32[$fd122 >> 2] = $F102_0;
          var $bk123 = $22 + 12;
          HEAP32[$bk123 >> 2] = $24;
        }
        HEAP32[__gm_ + 8 >> 2] = $sub88;
        HEAP32[__gm_ + 20 >> 2] = $19;
        var $mem_0 = $fd69;
        __label__ = 37;
        break;
      }
      if (HEAP32[__gm_ + 4 >> 2] == 0) {
        var $nb_0 = $cond;
        __label__ = 29;
        break;
      }
      var $call = _tmalloc_small($cond);
      if ($call == 0) {
        var $nb_0 = $cond;
        __label__ = 29;
        break;
      }
      var $mem_0 = $call;
      __label__ = 37;
      break;
    } else {
      if ($bytes > 4294967231) {
        var $nb_0 = -1;
        __label__ = 29;
        break;
      }
      var $and143 = $bytes + 11 & -8;
      if (HEAP32[__gm_ + 4 >> 2] == 0) {
        var $nb_0 = $and143;
        __label__ = 29;
        break;
      }
      var $call147 = _tmalloc_large($and143);
      if ($call147 == 0) {
        var $nb_0 = $and143;
        __label__ = 29;
        break;
      }
      var $mem_0 = $call147;
      __label__ = 37;
      break;
    }
  } while (0);
  if (__label__ == 29) {
    var $nb_0;
    var $33 = HEAPU32[__gm_ + 8 >> 2];
    if ($nb_0 > $33) {
      var $42 = HEAPU32[__gm_ + 12 >> 2];
      if ($nb_0 < $42) {
        var $sub186 = $42 - $nb_0;
        HEAP32[__gm_ + 12 >> 2] = $sub186;
        var $43 = HEAPU32[__gm_ + 24 >> 2];
        var $44 = $43;
        HEAP32[__gm_ + 24 >> 2] = $44 + $nb_0;
        HEAP32[$44 + ($nb_0 + 4) >> 2] = $sub186 | 1;
        HEAP32[$43 + 4 >> 2] = $nb_0 | 3;
        var $mem_0 = $43 + 8;
      } else {
        var $call198 = _sys_alloc($nb_0);
        var $mem_0 = $call198;
      }
    } else {
      var $sub158 = $33 - $nb_0;
      var $34 = HEAPU32[__gm_ + 20 >> 2];
      if ($sub158 > 15) {
        var $35 = $34;
        HEAP32[__gm_ + 20 >> 2] = $35 + $nb_0;
        HEAP32[__gm_ + 8 >> 2] = $sub158;
        HEAP32[$35 + ($nb_0 + 4) >> 2] = $sub158 | 1;
        HEAP32[$35 + $33 >> 2] = $sub158;
        HEAP32[$34 + 4 >> 2] = $nb_0 | 3;
      } else {
        HEAP32[__gm_ + 8 >> 2] = 0;
        HEAP32[__gm_ + 20 >> 2] = 0;
        HEAP32[$34 + 4 >> 2] = $33 | 3;
        var $39 = $34 + ($33 + 4);
        var $or178 = HEAP32[$39 >> 2] | 1;
        HEAP32[$39 >> 2] = $or178;
      }
      var $mem_0 = $34 + 8;
    }
  }
  var $mem_0;
  return $mem_0;
  return null;
}

_malloc["X"] = 1;

function _tmalloc_small($nb) {
  var $R_1$s2;
  var $v_0_ph$s2;
  var __label__;
  var $0 = HEAP32[__gm_ + 4 >> 2];
  var $sub2 = ($0 & -$0) - 1;
  var $and3 = $sub2 >>> 12 & 16;
  var $shr4 = $sub2 >>> $and3;
  var $and6 = $shr4 >>> 5 & 8;
  var $shr7 = $shr4 >>> $and6;
  var $and9 = $shr7 >>> 2 & 4;
  var $shr11 = $shr7 >>> $and9;
  var $and13 = $shr11 >>> 1 & 2;
  var $shr15 = $shr11 >>> $and13;
  var $and17 = $shr15 >>> 1 & 1;
  var $1 = HEAPU32[__gm_ + (($and6 | $and3 | $and9 | $and13 | $and17) + ($shr15 >>> $and17) << 2) + 304 >> 2];
  var $v_0_ph = $1, $v_0_ph$s2 = $v_0_ph >> 2;
  var $rsize_0_ph = (HEAP32[$1 + 4 >> 2] & -8) - $nb;
  $while_cond_outer$54 : while (1) {
    var $rsize_0_ph;
    var $v_0_ph;
    var $t_0 = $v_0_ph;
    while (1) {
      var $t_0;
      var $3 = HEAP32[$t_0 + 16 >> 2];
      if ($3 == 0) {
        var $4 = HEAP32[$t_0 + 20 >> 2];
        if ($4 == 0) {
          break $while_cond_outer$54;
        }
        var $cond5 = $4;
      } else {
        var $cond5 = $3;
      }
      var $cond5;
      var $sub31 = (HEAP32[$cond5 + 4 >> 2] & -8) - $nb;
      if ($sub31 < $rsize_0_ph) {
        var $v_0_ph = $cond5, $v_0_ph$s2 = $v_0_ph >> 2;
        var $rsize_0_ph = $sub31;
        continue $while_cond_outer$54;
      }
      var $t_0 = $cond5;
    }
  }
  var $6 = $v_0_ph;
  var $7 = HEAPU32[__gm_ + 16 >> 2];
  var $cmp33 = $6 < $7;
  do {
    if (!$cmp33) {
      var $add_ptr = $6 + $nb;
      var $8 = $add_ptr;
      if ($6 >= $add_ptr) {
        break;
      }
      var $9 = HEAPU32[$v_0_ph$s2 + 6];
      var $10 = HEAPU32[$v_0_ph$s2 + 3];
      var $cmp40 = $10 == $v_0_ph;
      do {
        if ($cmp40) {
          var $arrayidx55 = $v_0_ph + 20;
          var $13 = HEAP32[$arrayidx55 >> 2];
          if ($13 == 0) {
            var $arrayidx59 = $v_0_ph + 16;
            var $14 = HEAP32[$arrayidx59 >> 2];
            if ($14 == 0) {
              var $R_1 = 0, $R_1$s2 = $R_1 >> 2;
              break;
            }
            var $RP_0 = $arrayidx59;
            var $R_0 = $14;
          } else {
            var $RP_0 = $arrayidx55;
            var $R_0 = $13;
            __label__ = 13;
          }
          while (1) {
            var $R_0;
            var $RP_0;
            var $arrayidx65 = $R_0 + 20;
            var $15 = HEAP32[$arrayidx65 >> 2];
            if ($15 != 0) {
              var $RP_0 = $arrayidx65;
              var $R_0 = $15;
              continue;
            }
            var $arrayidx69 = $R_0 + 16;
            var $16 = HEAPU32[$arrayidx69 >> 2];
            if ($16 == 0) {
              break;
            }
            var $RP_0 = $arrayidx69;
            var $R_0 = $16;
          }
          if ($RP_0 < $7) {
            _abort();
            throw "Reached an unreachable!";
          } else {
            HEAP32[$RP_0 >> 2] = 0;
            var $R_1 = $R_0, $R_1$s2 = $R_1 >> 2;
          }
        } else {
          var $11 = HEAPU32[$v_0_ph$s2 + 2];
          if ($11 < $7) {
            _abort();
            throw "Reached an unreachable!";
          } else {
            HEAP32[$11 + 12 >> 2] = $10;
            HEAP32[$10 + 8 >> 2] = $11;
            var $R_1 = $10, $R_1$s2 = $R_1 >> 2;
          }
        }
      } while (0);
      var $R_1;
      var $cmp84 = $9 == 0;
      $if_end167$$if_then86$81 : do {
        if (!$cmp84) {
          var $index = $v_0_ph + 28;
          var $arrayidx88 = (HEAP32[$index >> 2] << 2) + __gm_ + 304;
          var $cmp89 = $v_0_ph == HEAP32[$arrayidx88 >> 2];
          do {
            if ($cmp89) {
              HEAP32[$arrayidx88 >> 2] = $R_1;
              if ($R_1 != 0) {
                break;
              }
              var $and97 = HEAP32[__gm_ + 4 >> 2] & (1 << HEAP32[$index >> 2] ^ -1);
              HEAP32[__gm_ + 4 >> 2] = $and97;
              break $if_end167$$if_then86$81;
            }
            if ($9 < HEAPU32[__gm_ + 16 >> 2]) {
              _abort();
              throw "Reached an unreachable!";
            } else {
              var $arrayidx107 = $9 + 16;
              if (HEAP32[$arrayidx107 >> 2] == $v_0_ph) {
                HEAP32[$arrayidx107 >> 2] = $R_1;
              } else {
                HEAP32[$9 + 20 >> 2] = $R_1;
              }
              if ($R_1 == 0) {
                break $if_end167$$if_then86$81;
              }
            }
          } while (0);
          if ($R_1 < HEAPU32[__gm_ + 16 >> 2]) {
            _abort();
            throw "Reached an unreachable!";
          } else {
            HEAP32[$R_1$s2 + 6] = $9;
            var $27 = HEAPU32[$v_0_ph$s2 + 4];
            if ($27 != 0) {
              if ($27 < HEAPU32[__gm_ + 16 >> 2]) {
                _abort();
                throw "Reached an unreachable!";
              } else {
                HEAP32[$R_1$s2 + 4] = $27;
                HEAP32[$27 + 24 >> 2] = $R_1;
              }
            }
            var $30 = HEAPU32[$v_0_ph$s2 + 5];
            if ($30 == 0) {
              break;
            }
            if ($30 < HEAPU32[__gm_ + 16 >> 2]) {
              _abort();
              throw "Reached an unreachable!";
            } else {
              HEAP32[$R_1$s2 + 5] = $30;
              HEAP32[$30 + 24 >> 2] = $R_1;
            }
          }
        }
      } while (0);
      if ($rsize_0_ph < 16) {
        var $add171 = $rsize_0_ph + $nb;
        HEAP32[$v_0_ph$s2 + 1] = $add171 | 3;
        var $33 = $6 + ($add171 + 4);
        var $or177 = HEAP32[$33 >> 2] | 1;
        HEAP32[$33 >> 2] = $or177;
      } else {
        HEAP32[$v_0_ph$s2 + 1] = $nb | 3;
        HEAP32[$6 + ($nb + 4) >> 2] = $rsize_0_ph | 1;
        HEAP32[$6 + $rsize_0_ph + $nb >> 2] = $rsize_0_ph;
        var $36 = HEAPU32[__gm_ + 8 >> 2];
        if ($36 != 0) {
          var $37 = HEAPU32[__gm_ + 20 >> 2];
          var $shl189 = $36 >>> 2 & 1073741822;
          var $39 = ($shl189 << 2) + __gm_ + 40;
          var $40 = HEAPU32[__gm_ >> 2];
          var $shl192 = 1 << ($36 >>> 3);
          var $tobool194 = ($40 & $shl192) == 0;
          do {
            if ($tobool194) {
              HEAP32[__gm_ >> 2] = $40 | $shl192;
              var $F191_0 = $39;
              var $_pre_phi = ($shl189 + 2 << 2) + __gm_ + 40;
            } else {
              var $41 = ($shl189 + 2 << 2) + __gm_ + 40;
              var $42 = HEAPU32[$41 >> 2];
              if ($42 >= HEAPU32[__gm_ + 16 >> 2]) {
                var $F191_0 = $42;
                var $_pre_phi = $41;
                break;
              }
              _abort();
              throw "Reached an unreachable!";
            }
          } while (0);
          var $_pre_phi;
          var $F191_0;
          HEAP32[$_pre_phi >> 2] = $37;
          HEAP32[$F191_0 + 12 >> 2] = $37;
          HEAP32[$37 + 8 >> 2] = $F191_0;
          HEAP32[$37 + 12 >> 2] = $39;
        }
        HEAP32[__gm_ + 8 >> 2] = $rsize_0_ph;
        HEAP32[__gm_ + 20 >> 2] = $8;
      }
      return $v_0_ph + 8;
    }
  } while (0);
  _abort();
  throw "Reached an unreachable!";
  return null;
}

_tmalloc_small["X"] = 1;

function _sys_alloc($nb) {
  var $sp_0$s2;
  var __label__;
  if (HEAP32[_mparams >> 2] == 0) {
    _init_mparams();
  }
  var $tobool11 = (HEAP32[__gm_ + 440 >> 2] & 4) == 0;
  do {
    if ($tobool11) {
      var $2 = HEAP32[__gm_ + 24 >> 2];
      var $cmp13 = $2 == 0;
      do {
        if ($cmp13) {
          __label__ = 5;
        } else {
          var $3 = $2;
          var $call15 = _segment_holding($3);
          if ($call15 == 0) {
            __label__ = 5;
            break;
          }
          var $8 = HEAP32[_mparams + 8 >> 2];
          var $and50 = $nb + 47 - HEAP32[__gm_ + 12 >> 2] + $8 & -$8;
          if ($and50 >= 2147483647) {
            __label__ = 13;
            break;
          }
          var $call53 = _sbrk($and50);
          if ($call53 == HEAP32[$call15 >> 2] + HEAP32[$call15 + 4 >> 2]) {
            var $tbase_0 = $call53;
            var $asize_1 = $and50;
            var $br_0 = $call53;
            __label__ = 12;
            break;
          }
          var $br_07 = $call53;
          var $asize_18 = $and50;
          __label__ = 14;
          break;
        }
      } while (0);
      do {
        if (__label__ == 5) {
          var $call18 = _sbrk(0);
          if ($call18 == -1) {
            __label__ = 13;
            break;
          }
          var $4 = HEAP32[_mparams + 8 >> 2];
          var $and23 = $nb + ($4 + 47) & -$4;
          var $5 = $call18;
          var $6 = HEAP32[_mparams + 4 >> 2];
          var $sub24 = $6 - 1;
          if (($sub24 & $5) == 0) {
            var $asize_0 = $and23;
          } else {
            var $asize_0 = $and23 - $5 + ($sub24 + $5 & -$6);
          }
          var $asize_0;
          if ($asize_0 >= 2147483647) {
            __label__ = 13;
            break;
          }
          var $call38 = _sbrk($asize_0);
          if ($call38 == $call18) {
            var $tbase_0 = $call18;
            var $asize_1 = $asize_0;
            var $br_0 = $call38;
            __label__ = 12;
            break;
          }
          var $br_07 = $call38;
          var $asize_18 = $asize_0;
          __label__ = 14;
          break;
        }
      } while (0);
      if (__label__ == 13) {
        var $or31 = HEAP32[__gm_ + 440 >> 2] | 4;
        HEAP32[__gm_ + 440 >> 2] = $or31;
        __label__ = 22;
        break;
      } else if (__label__ == 12) {
        var $br_0;
        var $asize_1;
        var $tbase_0;
        if ($tbase_0 != -1) {
          var $tsize_220 = $asize_1;
          var $tbase_221 = $tbase_0;
          __label__ = 25;
          break;
        }
        var $br_07 = $br_0;
        var $asize_18 = $asize_1;
      }
      var $asize_18;
      var $br_07;
      var $sub82 = -$asize_18;
      var $or_cond = $br_07 != -1 & $asize_18 < 2147483647;
      do {
        if ($or_cond) {
          if ($asize_18 >= $nb + 48) {
            var $asize_2 = $asize_18;
            __label__ = 20;
            break;
          }
          var $12 = HEAP32[_mparams + 8 >> 2];
          var $and74 = $nb + 47 - $asize_18 + $12 & -$12;
          if ($and74 >= 2147483647) {
            var $asize_2 = $asize_18;
            __label__ = 20;
            break;
          }
          var $call77 = _sbrk($and74);
          if ($call77 == -1) {
            var $call83 = _sbrk($sub82);
            __label__ = 21;
            break;
          }
          var $asize_2 = $and74 + $asize_18;
          __label__ = 20;
          break;
        } else {
          var $asize_2 = $asize_18;
          __label__ = 20;
        }
      } while (0);
      if (__label__ == 20) {
        var $asize_2;
        if ($br_07 != -1) {
          var $tsize_220 = $asize_2;
          var $tbase_221 = $br_07;
          __label__ = 25;
          break;
        }
      }
      var $or = HEAP32[__gm_ + 440 >> 2] | 4;
      HEAP32[__gm_ + 440 >> 2] = $or;
      __label__ = 22;
      break;
    }
    __label__ = 22;
  } while (0);
  do {
    if (__label__ == 22) {
      var $14 = HEAP32[_mparams + 8 >> 2];
      var $and103 = $nb + ($14 + 47) & -$14;
      if ($and103 >= 2147483647) {
        __label__ = 48;
        break;
      }
      var $call108 = _sbrk($and103);
      var $call109 = _sbrk(0);
      if (!($call109 != -1 & $call108 != -1 & $call108 < $call109)) {
        __label__ = 48;
        break;
      }
      var $sub_ptr_sub = $call109 - $call108;
      if ($sub_ptr_sub <= $nb + 40 | $call108 == -1) {
        __label__ = 48;
        break;
      }
      var $tsize_220 = $sub_ptr_sub;
      var $tbase_221 = $call108;
      __label__ = 25;
      break;
    }
  } while (0);
  $if_end241$$if_then124$151 : do {
    if (__label__ == 25) {
      var $tbase_221;
      var $tsize_220;
      var $add125 = HEAP32[__gm_ + 432 >> 2] + $tsize_220;
      HEAP32[__gm_ + 432 >> 2] = $add125;
      if ($add125 > HEAPU32[__gm_ + 436 >> 2]) {
        HEAP32[__gm_ + 436 >> 2] = $add125;
      }
      var $17 = HEAPU32[__gm_ + 24 >> 2];
      var $cmp132 = $17 == 0;
      $if_then133$$while_cond$156 : do {
        if ($cmp132) {
          var $18 = HEAPU32[__gm_ + 16 >> 2];
          if ($18 == 0 | $tbase_221 < $18) {
            HEAP32[__gm_ + 16 >> 2] = $tbase_221;
          }
          HEAP32[__gm_ + 444 >> 2] = $tbase_221;
          HEAP32[__gm_ + 448 >> 2] = $tsize_220;
          HEAP32[__gm_ + 456 >> 2] = 0;
          var $19 = HEAP32[_mparams >> 2];
          HEAP32[__gm_ + 36 >> 2] = $19;
          HEAP32[__gm_ + 32 >> 2] = -1;
          _init_bins();
          _init_top($tbase_221, $tsize_220 - 40);
        } else {
          var $sp_0 = __gm_ + 444, $sp_0$s2 = $sp_0 >> 2;
          while (1) {
            var $sp_0;
            if ($sp_0 == 0) {
              break;
            }
            var $21 = HEAPU32[$sp_0$s2];
            var $size162 = $sp_0 + 4;
            var $22 = HEAPU32[$size162 >> 2];
            var $add_ptr163 = $21 + $22;
            if ($tbase_221 == $add_ptr163) {
              if ((HEAP32[$sp_0$s2 + 3] & 8) != 0) {
                break;
              }
              var $25 = $17;
              if (!($25 >= $21 & $25 < $add_ptr163)) {
                break;
              }
              HEAP32[$size162 >> 2] = $22 + $tsize_220;
              var $26 = HEAP32[__gm_ + 24 >> 2];
              var $add189 = HEAP32[__gm_ + 12 >> 2] + $tsize_220;
              _init_top($26, $add189);
              break $if_then133$$while_cond$156;
            }
            var $sp_0 = HEAP32[$sp_0$s2 + 2], $sp_0$s2 = $sp_0 >> 2;
          }
          if ($tbase_221 < HEAPU32[__gm_ + 16 >> 2]) {
            HEAP32[__gm_ + 16 >> 2] = $tbase_221;
          }
          var $add_ptr201 = $tbase_221 + $tsize_220;
          var $sp_1 = __gm_ + 444;
          while (1) {
            var $sp_1;
            if ($sp_1 == 0) {
              break;
            }
            var $base200 = $sp_1;
            var $29 = HEAPU32[$base200 >> 2];
            if ($29 == $add_ptr201) {
              if ((HEAP32[$sp_1 + 12 >> 2] & 8) != 0) {
                break;
              }
              HEAP32[$base200 >> 2] = $tbase_221;
              var $size219 = $sp_1 + 4;
              var $add220 = HEAP32[$size219 >> 2] + $tsize_220;
              HEAP32[$size219 >> 2] = $add220;
              var $call221 = _prepend_alloc($tbase_221, $29, $nb);
              var $retval_0 = $call221;
              __label__ = 49;
              break $if_end241$$if_then124$151;
            }
            var $sp_1 = HEAP32[$sp_1 + 8 >> 2];
          }
          _add_segment($tbase_221, $tsize_220);
        }
      } while (0);
      var $33 = HEAPU32[__gm_ + 12 >> 2];
      if ($33 <= $nb) {
        __label__ = 48;
        break;
      }
      var $sub230 = $33 - $nb;
      HEAP32[__gm_ + 12 >> 2] = $sub230;
      var $34 = HEAPU32[__gm_ + 24 >> 2];
      var $35 = $34;
      HEAP32[__gm_ + 24 >> 2] = $35 + $nb;
      HEAP32[$35 + ($nb + 4) >> 2] = $sub230 | 1;
      HEAP32[$34 + 4 >> 2] = $nb | 3;
      var $retval_0 = $34 + 8;
      __label__ = 49;
      break;
    }
  } while (0);
  if (__label__ == 48) {
    var $call242 = ___errno();
    HEAP32[$call242 >> 2] = 12;
    var $retval_0 = 0;
  }
  var $retval_0;
  return $retval_0;
  return null;
}

_sys_alloc["X"] = 1;

function _tmalloc_large($nb) {
  var $R_1$s2;
  var $10$s2;
  var $t_221$s2;
  var $v_3_lcssa$s2;
  var $t_0$s2;
  var $nb$s2 = $nb >> 2;
  var __label__;
  var $sub = -$nb;
  var $shr = $nb >>> 8;
  var $cmp = $shr == 0;
  do {
    if ($cmp) {
      var $idx_0 = 0;
    } else {
      if ($nb > 16777215) {
        var $idx_0 = 31;
        break;
      }
      var $and = $shr + 1048320 >>> 16 & 8;
      var $shl = $shr << $and;
      var $and8 = $shl + 520192 >>> 16 & 4;
      var $shl9 = $shl << $and8;
      var $and12 = $shl9 + 245760 >>> 16 & 2;
      var $add17 = 14 - ($and8 | $and | $and12) + ($shl9 << $and12 >>> 15);
      var $idx_0 = $nb >>> $add17 + 7 & 1 | $add17 << 1;
    }
  } while (0);
  var $idx_0;
  var $0 = HEAPU32[__gm_ + ($idx_0 << 2) + 304 >> 2];
  var $cmp24 = $0 == 0;
  $if_end53$$if_then25$6 : do {
    if ($cmp24) {
      var $v_2 = 0;
      var $rsize_2 = $sub;
      var $t_1 = 0;
    } else {
      if ($idx_0 == 31) {
        var $cond = 0;
      } else {
        var $cond = 25 - ($idx_0 >>> 1);
      }
      var $cond;
      var $v_0 = 0;
      var $rsize_0 = $sub;
      var $t_0 = $0, $t_0$s2 = $t_0 >> 2;
      var $sizebits_0 = $nb << $cond;
      var $rst_0 = 0;
      while (1) {
        var $rst_0;
        var $sizebits_0;
        var $t_0;
        var $rsize_0;
        var $v_0;
        var $and32 = HEAP32[$t_0$s2 + 1] & -8;
        var $sub33 = $and32 - $nb;
        if ($sub33 < $rsize_0) {
          if ($and32 == $nb) {
            var $v_2 = $t_0;
            var $rsize_2 = $sub33;
            var $t_1 = $t_0;
            break $if_end53$$if_then25$6;
          }
          var $v_1 = $t_0;
          var $rsize_1 = $sub33;
        } else {
          var $v_1 = $v_0;
          var $rsize_1 = $rsize_0;
        }
        var $rsize_1;
        var $v_1;
        var $2 = HEAPU32[$t_0$s2 + 5];
        var $3 = HEAPU32[(($sizebits_0 >>> 31 << 2) + 16 >> 2) + $t_0$s2];
        var $rst_1 = $2 == 0 | $2 == $3 ? $rst_0 : $2;
        if ($3 == 0) {
          var $v_2 = $v_1;
          var $rsize_2 = $rsize_1;
          var $t_1 = $rst_1;
          break $if_end53$$if_then25$6;
        }
        var $v_0 = $v_1;
        var $rsize_0 = $rsize_1;
        var $t_0 = $3, $t_0$s2 = $t_0 >> 2;
        var $sizebits_0 = $sizebits_0 << 1;
        var $rst_0 = $rst_1;
      }
    }
  } while (0);
  var $t_1;
  var $rsize_2;
  var $v_2;
  var $or_cond16 = $t_1 == 0 & $v_2 == 0;
  do {
    if ($or_cond16) {
      var $shl59 = 2 << $idx_0;
      var $and63 = HEAP32[__gm_ + 4 >> 2] & ($shl59 | -$shl59);
      if ($and63 == 0) {
        var $t_2_ph = $t_1;
        break;
      }
      var $sub69 = ($and63 & -$and63) - 1;
      var $and72 = $sub69 >>> 12 & 16;
      var $shr74 = $sub69 >>> $and72;
      var $and76 = $shr74 >>> 5 & 8;
      var $shr78 = $shr74 >>> $and76;
      var $and80 = $shr78 >>> 2 & 4;
      var $shr82 = $shr78 >>> $and80;
      var $and84 = $shr82 >>> 1 & 2;
      var $shr86 = $shr82 >>> $and84;
      var $and88 = $shr86 >>> 1 & 1;
      var $t_2_ph = HEAP32[__gm_ + (($and76 | $and72 | $and80 | $and84 | $and88) + ($shr86 >>> $and88) << 2) + 304 >> 2];
    } else {
      var $t_2_ph = $t_1;
    }
  } while (0);
  var $t_2_ph;
  var $cmp9620 = $t_2_ph == 0;
  $while_end$$while_body$22 : do {
    if ($cmp9620) {
      var $rsize_3_lcssa = $rsize_2;
      var $v_3_lcssa = $v_2, $v_3_lcssa$s2 = $v_3_lcssa >> 2;
    } else {
      var $t_221 = $t_2_ph, $t_221$s2 = $t_221 >> 2;
      var $rsize_322 = $rsize_2;
      var $v_323 = $v_2;
      while (1) {
        var $v_323;
        var $rsize_322;
        var $t_221;
        var $sub100 = (HEAP32[$t_221$s2 + 1] & -8) - $nb;
        var $cmp101 = $sub100 < $rsize_322;
        var $rsize_4 = $cmp101 ? $sub100 : $rsize_322;
        var $v_4 = $cmp101 ? $t_221 : $v_323;
        var $7 = HEAPU32[$t_221$s2 + 4];
        if ($7 != 0) {
          var $t_221 = $7, $t_221$s2 = $t_221 >> 2;
          var $rsize_322 = $rsize_4;
          var $v_323 = $v_4;
          continue;
        }
        var $8 = HEAPU32[$t_221$s2 + 5];
        if ($8 == 0) {
          var $rsize_3_lcssa = $rsize_4;
          var $v_3_lcssa = $v_4, $v_3_lcssa$s2 = $v_3_lcssa >> 2;
          break $while_end$$while_body$22;
        }
        var $t_221 = $8, $t_221$s2 = $t_221 >> 2;
        var $rsize_322 = $rsize_4;
        var $v_323 = $v_4;
      }
    }
  } while (0);
  var $v_3_lcssa;
  var $rsize_3_lcssa;
  var $cmp115 = $v_3_lcssa == 0;
  $return$$land_lhs_true116$27 : do {
    if ($cmp115) {
      var $retval_0 = 0;
    } else {
      if ($rsize_3_lcssa >= HEAP32[__gm_ + 8 >> 2] - $nb) {
        var $retval_0 = 0;
        break;
      }
      var $10 = $v_3_lcssa, $10$s2 = $10 >> 2;
      var $11 = HEAPU32[__gm_ + 16 >> 2];
      var $cmp120 = $10 < $11;
      do {
        if (!$cmp120) {
          var $add_ptr = $10 + $nb;
          var $12 = $add_ptr;
          if ($10 >= $add_ptr) {
            break;
          }
          var $13 = HEAPU32[$v_3_lcssa$s2 + 6];
          var $14 = HEAPU32[$v_3_lcssa$s2 + 3];
          var $cmp127 = $14 == $v_3_lcssa;
          do {
            if ($cmp127) {
              var $arrayidx143 = $v_3_lcssa + 20;
              var $17 = HEAP32[$arrayidx143 >> 2];
              if ($17 == 0) {
                var $arrayidx147 = $v_3_lcssa + 16;
                var $18 = HEAP32[$arrayidx147 >> 2];
                if ($18 == 0) {
                  var $R_1 = 0, $R_1$s2 = $R_1 >> 2;
                  break;
                }
                var $RP_0 = $arrayidx147;
                var $R_0 = $18;
              } else {
                var $RP_0 = $arrayidx143;
                var $R_0 = $17;
                __label__ = 27;
              }
              while (1) {
                var $R_0;
                var $RP_0;
                var $arrayidx153 = $R_0 + 20;
                var $19 = HEAP32[$arrayidx153 >> 2];
                if ($19 != 0) {
                  var $RP_0 = $arrayidx153;
                  var $R_0 = $19;
                  continue;
                }
                var $arrayidx157 = $R_0 + 16;
                var $20 = HEAPU32[$arrayidx157 >> 2];
                if ($20 == 0) {
                  break;
                }
                var $RP_0 = $arrayidx157;
                var $R_0 = $20;
              }
              if ($RP_0 < $11) {
                _abort();
                throw "Reached an unreachable!";
              } else {
                HEAP32[$RP_0 >> 2] = 0;
                var $R_1 = $R_0, $R_1$s2 = $R_1 >> 2;
              }
            } else {
              var $15 = HEAPU32[$v_3_lcssa$s2 + 2];
              if ($15 < $11) {
                _abort();
                throw "Reached an unreachable!";
              } else {
                HEAP32[$15 + 12 >> 2] = $14;
                HEAP32[$14 + 8 >> 2] = $15;
                var $R_1 = $14, $R_1$s2 = $R_1 >> 2;
              }
            }
          } while (0);
          var $R_1;
          var $cmp172 = $13 == 0;
          $if_end256$$if_then174$49 : do {
            if (!$cmp172) {
              var $index = $v_3_lcssa + 28;
              var $arrayidx176 = (HEAP32[$index >> 2] << 2) + __gm_ + 304;
              var $cmp177 = $v_3_lcssa == HEAP32[$arrayidx176 >> 2];
              do {
                if ($cmp177) {
                  HEAP32[$arrayidx176 >> 2] = $R_1;
                  if ($R_1 != 0) {
                    break;
                  }
                  var $and186 = HEAP32[__gm_ + 4 >> 2] & (1 << HEAP32[$index >> 2] ^ -1);
                  HEAP32[__gm_ + 4 >> 2] = $and186;
                  break $if_end256$$if_then174$49;
                }
                if ($13 < HEAPU32[__gm_ + 16 >> 2]) {
                  _abort();
                  throw "Reached an unreachable!";
                } else {
                  var $arrayidx196 = $13 + 16;
                  if (HEAP32[$arrayidx196 >> 2] == $v_3_lcssa) {
                    HEAP32[$arrayidx196 >> 2] = $R_1;
                  } else {
                    HEAP32[$13 + 20 >> 2] = $R_1;
                  }
                  if ($R_1 == 0) {
                    break $if_end256$$if_then174$49;
                  }
                }
              } while (0);
              if ($R_1 < HEAPU32[__gm_ + 16 >> 2]) {
                _abort();
                throw "Reached an unreachable!";
              } else {
                HEAP32[$R_1$s2 + 6] = $13;
                var $31 = HEAPU32[$v_3_lcssa$s2 + 4];
                if ($31 != 0) {
                  if ($31 < HEAPU32[__gm_ + 16 >> 2]) {
                    _abort();
                    throw "Reached an unreachable!";
                  } else {
                    HEAP32[$R_1$s2 + 4] = $31;
                    HEAP32[$31 + 24 >> 2] = $R_1;
                  }
                }
                var $34 = HEAPU32[$v_3_lcssa$s2 + 5];
                if ($34 == 0) {
                  break;
                }
                if ($34 < HEAPU32[__gm_ + 16 >> 2]) {
                  _abort();
                  throw "Reached an unreachable!";
                } else {
                  HEAP32[$R_1$s2 + 5] = $34;
                  HEAP32[$34 + 24 >> 2] = $R_1;
                }
              }
            }
          } while (0);
          var $cmp257 = $rsize_3_lcssa < 16;
          $if_then259$$if_else268$77 : do {
            if ($cmp257) {
              var $add260 = $rsize_3_lcssa + $nb;
              HEAP32[$v_3_lcssa$s2 + 1] = $add260 | 3;
              var $37 = $10 + ($add260 + 4);
              var $or267 = HEAP32[$37 >> 2] | 1;
              HEAP32[$37 >> 2] = $or267;
            } else {
              HEAP32[$v_3_lcssa$s2 + 1] = $nb | 3;
              HEAP32[$10$s2 + ($nb$s2 + 1)] = $rsize_3_lcssa | 1;
              HEAP32[($rsize_3_lcssa >> 2) + $10$s2 + $nb$s2] = $rsize_3_lcssa;
              if ($rsize_3_lcssa < 256) {
                var $shl280 = $rsize_3_lcssa >>> 2 & 1073741822;
                var $41 = ($shl280 << 2) + __gm_ + 40;
                var $42 = HEAPU32[__gm_ >> 2];
                var $shl283 = 1 << ($rsize_3_lcssa >>> 3);
                var $tobool285 = ($42 & $shl283) == 0;
                do {
                  if ($tobool285) {
                    HEAP32[__gm_ >> 2] = $42 | $shl283;
                    var $F282_0 = $41;
                    var $_pre_phi = ($shl280 + 2 << 2) + __gm_ + 40;
                  } else {
                    var $43 = ($shl280 + 2 << 2) + __gm_ + 40;
                    var $44 = HEAPU32[$43 >> 2];
                    if ($44 >= HEAPU32[__gm_ + 16 >> 2]) {
                      var $F282_0 = $44;
                      var $_pre_phi = $43;
                      break;
                    }
                    _abort();
                    throw "Reached an unreachable!";
                  }
                } while (0);
                var $_pre_phi;
                var $F282_0;
                HEAP32[$_pre_phi >> 2] = $12;
                HEAP32[$F282_0 + 12 >> 2] = $12;
                HEAP32[$10$s2 + ($nb$s2 + 2)] = $F282_0;
                HEAP32[$10$s2 + ($nb$s2 + 3)] = $41;
              } else {
                var $49 = $add_ptr;
                var $shr310 = $rsize_3_lcssa >>> 8;
                var $cmp311 = $shr310 == 0;
                do {
                  if ($cmp311) {
                    var $I308_0 = 0;
                  } else {
                    if ($rsize_3_lcssa > 16777215) {
                      var $I308_0 = 31;
                      break;
                    }
                    var $and323 = $shr310 + 1048320 >>> 16 & 8;
                    var $shl325 = $shr310 << $and323;
                    var $and328 = $shl325 + 520192 >>> 16 & 4;
                    var $shl330 = $shl325 << $and328;
                    var $and333 = $shl330 + 245760 >>> 16 & 2;
                    var $add338 = 14 - ($and328 | $and323 | $and333) + ($shl330 << $and333 >>> 15);
                    var $I308_0 = $rsize_3_lcssa >>> $add338 + 7 & 1 | $add338 << 1;
                  }
                } while (0);
                var $I308_0;
                var $arrayidx347 = ($I308_0 << 2) + __gm_ + 304;
                HEAP32[$10$s2 + ($nb$s2 + 7)] = $I308_0;
                var $child349 = $10 + ($nb + 16);
                HEAP32[$10$s2 + ($nb$s2 + 5)] = 0;
                HEAP32[$child349 >> 2] = 0;
                var $52 = HEAP32[__gm_ + 4 >> 2];
                var $shl354 = 1 << $I308_0;
                if (($52 & $shl354) == 0) {
                  var $or360 = $52 | $shl354;
                  HEAP32[__gm_ + 4 >> 2] = $or360;
                  HEAP32[$arrayidx347 >> 2] = $49;
                  HEAP32[$10$s2 + ($nb$s2 + 6)] = $arrayidx347;
                  HEAP32[$10$s2 + ($nb$s2 + 3)] = $49;
                  HEAP32[$10$s2 + ($nb$s2 + 2)] = $49;
                } else {
                  if ($I308_0 == 31) {
                    var $cond375 = 0;
                  } else {
                    var $cond375 = 25 - ($I308_0 >>> 1);
                  }
                  var $cond375;
                  var $K365_0 = $rsize_3_lcssa << $cond375;
                  var $T_0 = HEAP32[$arrayidx347 >> 2];
                  while (1) {
                    var $T_0;
                    var $K365_0;
                    if ((HEAP32[$T_0 + 4 >> 2] & -8) == $rsize_3_lcssa) {
                      var $fd405 = $T_0 + 8;
                      var $65 = HEAPU32[$fd405 >> 2];
                      var $67 = HEAPU32[__gm_ + 16 >> 2];
                      var $cmp407 = $T_0 < $67;
                      do {
                        if (!$cmp407) {
                          if ($65 < $67) {
                            break;
                          }
                          HEAP32[$65 + 12 >> 2] = $49;
                          HEAP32[$fd405 >> 2] = $49;
                          HEAP32[$10$s2 + ($nb$s2 + 2)] = $65;
                          HEAP32[$10$s2 + ($nb$s2 + 3)] = $T_0;
                          HEAP32[$10$s2 + ($nb$s2 + 6)] = 0;
                          break $if_then259$$if_else268$77;
                        }
                      } while (0);
                      _abort();
                      throw "Reached an unreachable!";
                    } else {
                      var $arrayidx386 = ($K365_0 >>> 31 << 2) + $T_0 + 16;
                      var $59 = HEAPU32[$arrayidx386 >> 2];
                      if ($59 == 0) {
                        if ($arrayidx386 >= HEAPU32[__gm_ + 16 >> 2]) {
                          HEAP32[$arrayidx386 >> 2] = $49;
                          HEAP32[$10$s2 + ($nb$s2 + 6)] = $T_0;
                          HEAP32[$10$s2 + ($nb$s2 + 3)] = $49;
                          HEAP32[$10$s2 + ($nb$s2 + 2)] = $49;
                          break $if_then259$$if_else268$77;
                        }
                        _abort();
                        throw "Reached an unreachable!";
                      } else {
                        var $K365_0 = $K365_0 << 1;
                        var $T_0 = $59;
                      }
                    }
                  }
                }
              }
            }
          } while (0);
          var $retval_0 = $v_3_lcssa + 8;
          break $return$$land_lhs_true116$27;
        }
      } while (0);
      _abort();
      throw "Reached an unreachable!";
    }
  } while (0);
  var $retval_0;
  return $retval_0;
  return null;
}

_tmalloc_large["X"] = 1;

function _sys_trim($pad) {
  var $size$s2;
  if (HEAP32[_mparams >> 2] == 0) {
    _init_mparams();
  }
  var $cmp1 = $pad < 4294967232;
  $land_lhs_true$$if_end51$183 : do {
    if ($cmp1) {
      var $1 = HEAPU32[__gm_ + 24 >> 2];
      if ($1 == 0) {
        var $released_2 = 0;
        break;
      }
      var $2 = HEAPU32[__gm_ + 12 >> 2];
      var $cmp3 = $2 > $pad + 40;
      do {
        if ($cmp3) {
          var $3 = HEAPU32[_mparams + 8 >> 2];
          var $add7 = -40 - $pad - 1 + $2 + $3;
          var $div = Math.floor($add7 / $3);
          var $mul = ($div - 1) * $3;
          var $4 = $1;
          var $call10 = _segment_holding($4);
          if ((HEAP32[$call10 + 12 >> 2] & 8) != 0) {
            break;
          }
          var $call20 = _sbrk(0);
          var $size$s2 = $call10 + 4 >> 2;
          if ($call20 != HEAP32[$call10 >> 2] + HEAP32[$size$s2]) {
            break;
          }
          var $sub19_mul = $mul > 2147483646 ? -2147483648 - $3 : $mul;
          var $sub23 = -$sub19_mul;
          var $call24 = _sbrk($sub23);
          var $call25 = _sbrk(0);
          if (!($call24 != -1 & $call25 < $call20)) {
            break;
          }
          var $sub_ptr_sub = $call20 - $call25;
          if ($call20 == $call25) {
            break;
          }
          var $sub37 = HEAP32[$size$s2] - $sub_ptr_sub;
          HEAP32[$size$s2] = $sub37;
          var $sub38 = HEAP32[__gm_ + 432 >> 2] - $sub_ptr_sub;
          HEAP32[__gm_ + 432 >> 2] = $sub38;
          var $10 = HEAP32[__gm_ + 24 >> 2];
          var $sub41 = HEAP32[__gm_ + 12 >> 2] - $sub_ptr_sub;
          _init_top($10, $sub41);
          var $released_2 = $call20 != $call25;
          break $land_lhs_true$$if_end51$183;
        }
      } while (0);
      if (HEAPU32[__gm_ + 12 >> 2] <= HEAPU32[__gm_ + 28 >> 2]) {
        var $released_2 = 0;
        break;
      }
      HEAP32[__gm_ + 28 >> 2] = -1;
      var $released_2 = 0;
    } else {
      var $released_2 = 0;
    }
  } while (0);
  var $released_2;
  return $released_2;
  return null;
}

_sys_trim["X"] = 1;

function _free($mem) {
  var $R288_1$s2;
  var $R_1$s2;
  var $p_0$s2;
  var $48$s2;
  var $add_ptr_sum1$s2;
  var $and5$s2;
  var $mem$s2 = $mem >> 2;
  var __label__;
  var $cmp = $mem == 0;
  $if_end586$$if_then$2 : do {
    if (!$cmp) {
      var $add_ptr = $mem - 8;
      var $0 = $add_ptr;
      var $1 = HEAPU32[__gm_ + 16 >> 2];
      var $cmp1 = $add_ptr < $1;
      $erroraction$$land_rhs$4 : do {
        if (!$cmp1) {
          var $3 = HEAPU32[$mem - 4 >> 2];
          var $and = $3 & 3;
          if ($and == 1) {
            break;
          }
          var $and5 = $3 & -8, $and5$s2 = $and5 >> 2;
          var $add_ptr6 = $mem + ($and5 - 8);
          var $4 = $add_ptr6;
          var $tobool9 = ($3 & 1) == 0;
          $if_then10$$if_end198$7 : do {
            if ($tobool9) {
              var $5 = HEAPU32[$add_ptr >> 2];
              if ($and == 0) {
                break $if_end586$$if_then$2;
              }
              var $add_ptr_sum1 = -8 - $5, $add_ptr_sum1$s2 = $add_ptr_sum1 >> 2;
              var $add_ptr16 = $mem + $add_ptr_sum1;
              var $6 = $add_ptr16;
              var $add17 = $5 + $and5;
              if ($add_ptr16 < $1) {
                break $erroraction$$land_rhs$4;
              }
              if ($6 == HEAP32[__gm_ + 20 >> 2]) {
                var $48$s2 = $mem + ($and5 - 4) >> 2;
                if ((HEAP32[$48$s2] & 3) != 3) {
                  var $p_0 = $6, $p_0$s2 = $p_0 >> 2;
                  var $psize_0 = $add17;
                  break;
                }
                HEAP32[__gm_ + 8 >> 2] = $add17;
                var $and189 = HEAP32[$48$s2] & -2;
                HEAP32[$48$s2] = $and189;
                HEAP32[$mem$s2 + ($add_ptr_sum1$s2 + 1)] = $add17 | 1;
                HEAP32[$add_ptr6 >> 2] = $add17;
                break $if_end586$$if_then$2;
              }
              if ($5 < 256) {
                var $9 = HEAPU32[$mem$s2 + ($add_ptr_sum1$s2 + 2)];
                var $11 = HEAPU32[$mem$s2 + ($add_ptr_sum1$s2 + 3)];
                if ($9 == $11) {
                  var $and32 = HEAP32[__gm_ >> 2] & (1 << ($5 >>> 3) ^ -1);
                  HEAP32[__gm_ >> 2] = $and32;
                  var $p_0 = $6, $p_0$s2 = $p_0 >> 2;
                  var $psize_0 = $add17;
                } else {
                  var $14 = (($5 >>> 2 & 1073741822) << 2) + __gm_ + 40;
                  var $or_cond = $9 != $14 & $9 < $1;
                  do {
                    if (!$or_cond) {
                      if (!($11 == $14 | $11 >= $1)) {
                        break;
                      }
                      HEAP32[$9 + 12 >> 2] = $11;
                      HEAP32[$11 + 8 >> 2] = $9;
                      var $p_0 = $6, $p_0$s2 = $p_0 >> 2;
                      var $psize_0 = $add17;
                      break $if_then10$$if_end198$7;
                    }
                  } while (0);
                  _abort();
                  throw "Reached an unreachable!";
                }
              } else {
                var $17 = $add_ptr16;
                var $19 = HEAPU32[$mem$s2 + ($add_ptr_sum1$s2 + 6)];
                var $21 = HEAPU32[$mem$s2 + ($add_ptr_sum1$s2 + 3)];
                var $cmp57 = $21 == $17;
                do {
                  if ($cmp57) {
                    var $25 = $mem + ($add_ptr_sum1 + 20);
                    var $26 = HEAP32[$25 >> 2];
                    if ($26 == 0) {
                      var $arrayidx78 = $mem + ($add_ptr_sum1 + 16);
                      var $27 = HEAP32[$arrayidx78 >> 2];
                      if ($27 == 0) {
                        var $R_1 = 0, $R_1$s2 = $R_1 >> 2;
                        break;
                      }
                      var $RP_0 = $arrayidx78;
                      var $R_0 = $27;
                    } else {
                      var $RP_0 = $25;
                      var $R_0 = $26;
                      __label__ = 20;
                    }
                    while (1) {
                      var $R_0;
                      var $RP_0;
                      var $arrayidx83 = $R_0 + 20;
                      var $28 = HEAP32[$arrayidx83 >> 2];
                      if ($28 != 0) {
                        var $RP_0 = $arrayidx83;
                        var $R_0 = $28;
                        continue;
                      }
                      var $arrayidx88 = $R_0 + 16;
                      var $29 = HEAPU32[$arrayidx88 >> 2];
                      if ($29 == 0) {
                        break;
                      }
                      var $RP_0 = $arrayidx88;
                      var $R_0 = $29;
                    }
                    if ($RP_0 < $1) {
                      _abort();
                      throw "Reached an unreachable!";
                    } else {
                      HEAP32[$RP_0 >> 2] = 0;
                      var $R_1 = $R_0, $R_1$s2 = $R_1 >> 2;
                    }
                  } else {
                    var $23 = HEAPU32[$mem$s2 + ($add_ptr_sum1$s2 + 2)];
                    if ($23 < $1) {
                      _abort();
                      throw "Reached an unreachable!";
                    } else {
                      HEAP32[$23 + 12 >> 2] = $21;
                      HEAP32[$21 + 8 >> 2] = $23;
                      var $R_1 = $21, $R_1$s2 = $R_1 >> 2;
                    }
                  }
                } while (0);
                var $R_1;
                if ($19 == 0) {
                  var $p_0 = $6, $p_0$s2 = $p_0 >> 2;
                  var $psize_0 = $add17;
                  break;
                }
                var $31 = $mem + ($add_ptr_sum1 + 28);
                var $arrayidx104 = (HEAP32[$31 >> 2] << 2) + __gm_ + 304;
                var $cmp105 = $17 == HEAP32[$arrayidx104 >> 2];
                do {
                  if ($cmp105) {
                    HEAP32[$arrayidx104 >> 2] = $R_1;
                    if ($R_1 != 0) {
                      break;
                    }
                    var $and114 = HEAP32[__gm_ + 4 >> 2] & (1 << HEAP32[$31 >> 2] ^ -1);
                    HEAP32[__gm_ + 4 >> 2] = $and114;
                    var $p_0 = $6, $p_0$s2 = $p_0 >> 2;
                    var $psize_0 = $add17;
                    break $if_then10$$if_end198$7;
                  }
                  if ($19 < HEAPU32[__gm_ + 16 >> 2]) {
                    _abort();
                    throw "Reached an unreachable!";
                  } else {
                    var $arrayidx123 = $19 + 16;
                    if (HEAP32[$arrayidx123 >> 2] == $17) {
                      HEAP32[$arrayidx123 >> 2] = $R_1;
                    } else {
                      HEAP32[$19 + 20 >> 2] = $R_1;
                    }
                    if ($R_1 == 0) {
                      var $p_0 = $6, $p_0$s2 = $p_0 >> 2;
                      var $psize_0 = $add17;
                      break $if_then10$$if_end198$7;
                    }
                  }
                } while (0);
                if ($R_1 < HEAPU32[__gm_ + 16 >> 2]) {
                  _abort();
                  throw "Reached an unreachable!";
                } else {
                  HEAP32[$R_1$s2 + 6] = $19;
                  var $41 = HEAPU32[$mem$s2 + ($add_ptr_sum1$s2 + 4)];
                  if ($41 != 0) {
                    if ($41 < HEAPU32[__gm_ + 16 >> 2]) {
                      _abort();
                      throw "Reached an unreachable!";
                    } else {
                      HEAP32[$R_1$s2 + 4] = $41;
                      HEAP32[$41 + 24 >> 2] = $R_1;
                    }
                  }
                  var $45 = HEAPU32[$mem$s2 + ($add_ptr_sum1$s2 + 5)];
                  if ($45 == 0) {
                    var $p_0 = $6, $p_0$s2 = $p_0 >> 2;
                    var $psize_0 = $add17;
                    break;
                  }
                  if ($45 < HEAPU32[__gm_ + 16 >> 2]) {
                    _abort();
                    throw "Reached an unreachable!";
                  } else {
                    HEAP32[$R_1$s2 + 5] = $45;
                    HEAP32[$45 + 24 >> 2] = $R_1;
                    var $p_0 = $6, $p_0$s2 = $p_0 >> 2;
                    var $psize_0 = $add17;
                  }
                }
              }
            } else {
              var $p_0 = $0, $p_0$s2 = $p_0 >> 2;
              var $psize_0 = $and5;
            }
          } while (0);
          var $psize_0;
          var $p_0;
          var $52 = $p_0;
          if ($52 >= $add_ptr6) {
            break;
          }
          var $53 = $mem + ($and5 - 4);
          var $54 = HEAPU32[$53 >> 2];
          if (($54 & 1) == 0) {
            break;
          }
          var $tobool212 = ($54 & 2) == 0;
          do {
            if ($tobool212) {
              if ($4 == HEAP32[__gm_ + 24 >> 2]) {
                var $add217 = HEAP32[__gm_ + 12 >> 2] + $psize_0;
                HEAP32[__gm_ + 12 >> 2] = $add217;
                HEAP32[__gm_ + 24 >> 2] = $p_0;
                var $or218 = $add217 | 1;
                HEAP32[$p_0$s2 + 1] = $or218;
                if ($p_0 == HEAP32[__gm_ + 20 >> 2]) {
                  HEAP32[__gm_ + 20 >> 2] = 0;
                  HEAP32[__gm_ + 8 >> 2] = 0;
                }
                if ($add217 <= HEAPU32[__gm_ + 28 >> 2]) {
                  break $if_end586$$if_then$2;
                }
                var $59 = _sys_trim(0);
                break $if_end586$$if_then$2;
              }
              if ($4 == HEAP32[__gm_ + 20 >> 2]) {
                var $add232 = HEAP32[__gm_ + 8 >> 2] + $psize_0;
                HEAP32[__gm_ + 8 >> 2] = $add232;
                HEAP32[__gm_ + 20 >> 2] = $p_0;
                var $or233 = $add232 | 1;
                HEAP32[$p_0$s2 + 1] = $or233;
                var $prev_foot236 = $52 + $add232;
                HEAP32[$prev_foot236 >> 2] = $add232;
                break $if_end586$$if_then$2;
              }
              var $add240 = ($54 & -8) + $psize_0;
              var $shr241 = $54 >>> 3;
              var $cmp242 = $54 < 256;
              $if_then244$$if_else284$82 : do {
                if ($cmp242) {
                  var $63 = HEAPU32[$mem$s2 + $and5$s2];
                  var $65 = HEAPU32[(($and5 | 4) >> 2) + $mem$s2];
                  if ($63 == $65) {
                    var $and256 = HEAP32[__gm_ >> 2] & (1 << $shr241 ^ -1);
                    HEAP32[__gm_ >> 2] = $and256;
                  } else {
                    var $68 = (($54 >>> 2 & 1073741822) << 2) + __gm_ + 40;
                    var $cmp260 = $63 == $68;
                    do {
                      if ($cmp260) {
                        __label__ = 62;
                      } else {
                        if ($63 < HEAPU32[__gm_ + 16 >> 2]) {
                          __label__ = 65;
                          break;
                        }
                        __label__ = 62;
                        break;
                      }
                    } while (0);
                    do {
                      if (__label__ == 62) {
                        if ($65 != $68) {
                          if ($65 < HEAPU32[__gm_ + 16 >> 2]) {
                            break;
                          }
                        }
                        HEAP32[$63 + 12 >> 2] = $65;
                        HEAP32[$65 + 8 >> 2] = $63;
                        break $if_then244$$if_else284$82;
                      }
                    } while (0);
                    _abort();
                    throw "Reached an unreachable!";
                  }
                } else {
                  var $73 = $add_ptr6;
                  var $75 = HEAPU32[$mem$s2 + ($and5$s2 + 4)];
                  var $77 = HEAPU32[(($and5 | 4) >> 2) + $mem$s2];
                  var $cmp290 = $77 == $73;
                  do {
                    if ($cmp290) {
                      var $82 = $mem + ($and5 + 12);
                      var $83 = HEAP32[$82 >> 2];
                      if ($83 == 0) {
                        var $arrayidx313 = $mem + ($and5 + 8);
                        var $84 = HEAP32[$arrayidx313 >> 2];
                        if ($84 == 0) {
                          var $R288_1 = 0, $R288_1$s2 = $R288_1 >> 2;
                          break;
                        }
                        var $RP306_0 = $arrayidx313;
                        var $R288_0 = $84;
                      } else {
                        var $RP306_0 = $82;
                        var $R288_0 = $83;
                        __label__ = 72;
                      }
                      while (1) {
                        var $R288_0;
                        var $RP306_0;
                        var $arrayidx320 = $R288_0 + 20;
                        var $85 = HEAP32[$arrayidx320 >> 2];
                        if ($85 != 0) {
                          var $RP306_0 = $arrayidx320;
                          var $R288_0 = $85;
                          continue;
                        }
                        var $arrayidx325 = $R288_0 + 16;
                        var $86 = HEAPU32[$arrayidx325 >> 2];
                        if ($86 == 0) {
                          break;
                        }
                        var $RP306_0 = $arrayidx325;
                        var $R288_0 = $86;
                      }
                      if ($RP306_0 < HEAPU32[__gm_ + 16 >> 2]) {
                        _abort();
                        throw "Reached an unreachable!";
                      } else {
                        HEAP32[$RP306_0 >> 2] = 0;
                        var $R288_1 = $R288_0, $R288_1$s2 = $R288_1 >> 2;
                      }
                    } else {
                      var $79 = HEAPU32[$mem$s2 + $and5$s2];
                      if ($79 < HEAPU32[__gm_ + 16 >> 2]) {
                        _abort();
                        throw "Reached an unreachable!";
                      } else {
                        HEAP32[$79 + 12 >> 2] = $77;
                        HEAP32[$77 + 8 >> 2] = $79;
                        var $R288_1 = $77, $R288_1$s2 = $R288_1 >> 2;
                      }
                    }
                  } while (0);
                  var $R288_1;
                  if ($75 == 0) {
                    break;
                  }
                  var $89 = $mem + ($and5 + 20);
                  var $arrayidx345 = (HEAP32[$89 >> 2] << 2) + __gm_ + 304;
                  var $cmp346 = $73 == HEAP32[$arrayidx345 >> 2];
                  do {
                    if ($cmp346) {
                      HEAP32[$arrayidx345 >> 2] = $R288_1;
                      if ($R288_1 != 0) {
                        break;
                      }
                      var $and355 = HEAP32[__gm_ + 4 >> 2] & (1 << HEAP32[$89 >> 2] ^ -1);
                      HEAP32[__gm_ + 4 >> 2] = $and355;
                      break $if_then244$$if_else284$82;
                    }
                    if ($75 < HEAPU32[__gm_ + 16 >> 2]) {
                      _abort();
                      throw "Reached an unreachable!";
                    } else {
                      var $arrayidx364 = $75 + 16;
                      if (HEAP32[$arrayidx364 >> 2] == $73) {
                        HEAP32[$arrayidx364 >> 2] = $R288_1;
                      } else {
                        HEAP32[$75 + 20 >> 2] = $R288_1;
                      }
                      if ($R288_1 == 0) {
                        break $if_then244$$if_else284$82;
                      }
                    }
                  } while (0);
                  if ($R288_1 < HEAPU32[__gm_ + 16 >> 2]) {
                    _abort();
                    throw "Reached an unreachable!";
                  } else {
                    HEAP32[$R288_1$s2 + 6] = $75;
                    var $99 = HEAPU32[$mem$s2 + ($and5$s2 + 2)];
                    if ($99 != 0) {
                      if ($99 < HEAPU32[__gm_ + 16 >> 2]) {
                        _abort();
                        throw "Reached an unreachable!";
                      } else {
                        HEAP32[$R288_1$s2 + 4] = $99;
                        HEAP32[$99 + 24 >> 2] = $R288_1;
                      }
                    }
                    var $103 = HEAPU32[$mem$s2 + ($and5$s2 + 3)];
                    if ($103 == 0) {
                      break;
                    }
                    if ($103 < HEAPU32[__gm_ + 16 >> 2]) {
                      _abort();
                      throw "Reached an unreachable!";
                    } else {
                      HEAP32[$R288_1$s2 + 5] = $103;
                      HEAP32[$103 + 24 >> 2] = $R288_1;
                    }
                  }
                }
              } while (0);
              HEAP32[$p_0$s2 + 1] = $add240 | 1;
              HEAP32[$52 + $add240 >> 2] = $add240;
              if ($p_0 != HEAP32[__gm_ + 20 >> 2]) {
                var $psize_1 = $add240;
                break;
              }
              HEAP32[__gm_ + 8 >> 2] = $add240;
              break $if_end586$$if_then$2;
            } else {
              HEAP32[$53 >> 2] = $54 & -2;
              HEAP32[$p_0$s2 + 1] = $psize_0 | 1;
              HEAP32[$52 + $psize_0 >> 2] = $psize_0;
              var $psize_1 = $psize_0;
            }
          } while (0);
          var $psize_1;
          if ($psize_1 < 256) {
            var $shl450 = $psize_1 >>> 2 & 1073741822;
            var $108 = ($shl450 << 2) + __gm_ + 40;
            var $109 = HEAPU32[__gm_ >> 2];
            var $shl453 = 1 << ($psize_1 >>> 3);
            var $tobool455 = ($109 & $shl453) == 0;
            do {
              if ($tobool455) {
                HEAP32[__gm_ >> 2] = $109 | $shl453;
                var $F452_0 = $108;
                var $_pre_phi = ($shl450 + 2 << 2) + __gm_ + 40;
              } else {
                var $110 = ($shl450 + 2 << 2) + __gm_ + 40;
                var $111 = HEAPU32[$110 >> 2];
                if ($111 >= HEAPU32[__gm_ + 16 >> 2]) {
                  var $F452_0 = $111;
                  var $_pre_phi = $110;
                  break;
                }
                _abort();
                throw "Reached an unreachable!";
              }
            } while (0);
            var $_pre_phi;
            var $F452_0;
            HEAP32[$_pre_phi >> 2] = $p_0;
            HEAP32[$F452_0 + 12 >> 2] = $p_0;
            HEAP32[$p_0$s2 + 2] = $F452_0;
            HEAP32[$p_0$s2 + 3] = $108;
            break $if_end586$$if_then$2;
          }
          var $114 = $p_0;
          var $shr477 = $psize_1 >>> 8;
          var $cmp478 = $shr477 == 0;
          do {
            if ($cmp478) {
              var $I476_0 = 0;
            } else {
              if ($psize_1 > 16777215) {
                var $I476_0 = 31;
                break;
              }
              var $and487 = $shr477 + 1048320 >>> 16 & 8;
              var $shl488 = $shr477 << $and487;
              var $and491 = $shl488 + 520192 >>> 16 & 4;
              var $shl493 = $shl488 << $and491;
              var $and496 = $shl493 + 245760 >>> 16 & 2;
              var $add501 = 14 - ($and491 | $and487 | $and496) + ($shl493 << $and496 >>> 15);
              var $I476_0 = $psize_1 >>> $add501 + 7 & 1 | $add501 << 1;
            }
          } while (0);
          var $I476_0;
          var $arrayidx509 = ($I476_0 << 2) + __gm_ + 304;
          HEAP32[$p_0$s2 + 7] = $I476_0;
          HEAP32[$p_0$s2 + 5] = 0;
          HEAP32[$p_0$s2 + 4] = 0;
          var $116 = HEAP32[__gm_ + 4 >> 2];
          var $shl515 = 1 << $I476_0;
          var $tobool517 = ($116 & $shl515) == 0;
          $if_then518$$if_else524$154 : do {
            if ($tobool517) {
              var $or520 = $116 | $shl515;
              HEAP32[__gm_ + 4 >> 2] = $or520;
              HEAP32[$arrayidx509 >> 2] = $114;
              HEAP32[$p_0$s2 + 6] = $arrayidx509;
              HEAP32[$p_0$s2 + 3] = $p_0;
              HEAP32[$p_0$s2 + 2] = $p_0;
            } else {
              if ($I476_0 == 31) {
                var $cond = 0;
              } else {
                var $cond = 25 - ($I476_0 >>> 1);
              }
              var $cond;
              var $K525_0 = $psize_1 << $cond;
              var $T_0 = HEAP32[$arrayidx509 >> 2];
              while (1) {
                var $T_0;
                var $K525_0;
                if ((HEAP32[$T_0 + 4 >> 2] & -8) == $psize_1) {
                  var $fd559 = $T_0 + 8;
                  var $122 = HEAPU32[$fd559 >> 2];
                  var $124 = HEAPU32[__gm_ + 16 >> 2];
                  var $cmp560 = $T_0 < $124;
                  do {
                    if (!$cmp560) {
                      if ($122 < $124) {
                        break;
                      }
                      HEAP32[$122 + 12 >> 2] = $114;
                      HEAP32[$fd559 >> 2] = $114;
                      HEAP32[$p_0$s2 + 2] = $122;
                      HEAP32[$p_0$s2 + 3] = $T_0;
                      HEAP32[$p_0$s2 + 6] = 0;
                      break $if_then518$$if_else524$154;
                    }
                  } while (0);
                  _abort();
                  throw "Reached an unreachable!";
                } else {
                  var $arrayidx541 = ($K525_0 >>> 31 << 2) + $T_0 + 16;
                  var $119 = HEAPU32[$arrayidx541 >> 2];
                  if ($119 == 0) {
                    if ($arrayidx541 >= HEAPU32[__gm_ + 16 >> 2]) {
                      HEAP32[$arrayidx541 >> 2] = $114;
                      HEAP32[$p_0$s2 + 6] = $T_0;
                      HEAP32[$p_0$s2 + 3] = $p_0;
                      HEAP32[$p_0$s2 + 2] = $p_0;
                      break $if_then518$$if_else524$154;
                    }
                    _abort();
                    throw "Reached an unreachable!";
                  } else {
                    var $K525_0 = $K525_0 << 1;
                    var $T_0 = $119;
                  }
                }
              }
            }
          } while (0);
          var $dec = HEAP32[__gm_ + 32 >> 2] - 1;
          HEAP32[__gm_ + 32 >> 2] = $dec;
          if ($dec != 0) {
            break $if_end586$$if_then$2;
          }
          _release_unused_segments();
          break $if_end586$$if_then$2;
        }
      } while (0);
      _abort();
      throw "Reached an unreachable!";
    }
  } while (0);
  return;
  return;
}

_free["X"] = 1;

function _malloc_footprint() {
  return HEAP32[__gm_ + 432 >> 2];
  return null;
}

function _malloc_max_footprint() {
  return HEAP32[__gm_ + 436 >> 2];
  return null;
}

function _release_unused_segments() {
  var $sp_01 = HEAP32[__gm_ + 452 >> 2];
  var $cmp2 = $sp_01 == 0;
  $while_end256$$if_end255$2 : do {
    if (!$cmp2) {
      var $sp_03 = $sp_01;
      while (1) {
        var $sp_03;
        var $sp_0 = HEAP32[$sp_03 + 8 >> 2];
        if ($sp_0 == 0) {
          break $while_end256$$if_end255$2;
        }
        var $sp_03 = $sp_0;
      }
    }
  } while (0);
  HEAP32[__gm_ + 32 >> 2] = -1;
  return;
  return;
}

function _calloc($n_elements, $elem_size) {
  var $cmp = $n_elements == 0;
  do {
    if ($cmp) {
      var $req_0 = 0;
    } else {
      var $mul = $elem_size * $n_elements;
      if (($elem_size | $n_elements) <= 65535) {
        var $req_0 = $mul;
        break;
      }
      var $div = Math.floor($mul / $n_elements);
      if ($div == $elem_size) {
        var $req_0 = $mul;
        break;
      }
      var $req_0 = -1;
    }
  } while (0);
  var $req_0;
  var $call = _malloc($req_0);
  var $cmp4 = $call == 0;
  do {
    if (!$cmp4) {
      if ((HEAP32[$call - 4 >> 2] & 3) == 0) {
        break;
      }
      _memset($call, 0, $req_0, 1);
    }
  } while (0);
  return $call;
  return null;
}

function _realloc($oldmem, $bytes) {
  if ($oldmem == 0) {
    var $call = _malloc($bytes);
    var $retval_0 = $call;
  } else {
    var $call1 = _internal_realloc($oldmem, $bytes);
    var $retval_0 = $call1;
  }
  var $retval_0;
  return $retval_0;
  return null;
}

function _memalign($alignment, $bytes) {
  var $call = _internal_memalign($alignment, $bytes);
  return $call;
  return null;
}

function _internal_memalign($alignment, $bytes) {
  var $3$s2;
  var $cmp = $alignment < 9;
  do {
    if ($cmp) {
      var $call = _malloc($bytes);
      var $retval_0 = $call;
    } else {
      var $alignment_addr_0 = $alignment < 16 ? 16 : $alignment;
      var $cmp4 = ($alignment_addr_0 - 1 & $alignment_addr_0) == 0;
      $if_end7$$while_cond_preheader$56 : do {
        if ($cmp4) {
          var $alignment_addr_1 = $alignment_addr_0;
        } else {
          if ($alignment_addr_0 <= 16) {
            var $alignment_addr_1 = 16;
            break;
          }
          var $a_04 = 16;
          while (1) {
            var $a_04;
            var $shl = $a_04 << 1;
            if ($shl >= $alignment_addr_0) {
              var $alignment_addr_1 = $shl;
              break $if_end7$$while_cond_preheader$56;
            }
            var $a_04 = $shl;
          }
        }
      } while (0);
      var $alignment_addr_1;
      if (-64 - $alignment_addr_1 > $bytes) {
        if ($bytes < 11) {
          var $cond = 16;
        } else {
          var $cond = $bytes + 11 & -8;
        }
        var $cond;
        var $call21 = _malloc($alignment_addr_1 + ($cond + 12));
        if ($call21 == 0) {
          var $retval_0 = 0;
          break;
        }
        var $add_ptr = $call21 - 8;
        if ($call21 % $alignment_addr_1 == 0) {
          var $p_0_in = $add_ptr;
          var $leader_1 = 0;
        } else {
          var $2 = $call21 + ($alignment_addr_1 - 1) & -$alignment_addr_1;
          var $add_ptr30 = $2 - 8;
          var $sub_ptr_rhs_cast = $add_ptr;
          if ($add_ptr30 - $sub_ptr_rhs_cast > 15) {
            var $cond36 = $add_ptr30;
          } else {
            var $cond36 = $2 + ($alignment_addr_1 - 8);
          }
          var $cond36;
          var $sub_ptr_sub39 = $cond36 - $sub_ptr_rhs_cast;
          var $3$s2 = $call21 - 4 >> 2;
          var $4 = HEAP32[$3$s2];
          var $sub41 = ($4 & -8) - $sub_ptr_sub39;
          if (($4 & 3) == 0) {
            var $add46 = HEAP32[$add_ptr >> 2] + $sub_ptr_sub39;
            HEAP32[$cond36 >> 2] = $add46;
            HEAP32[$cond36 + 4 >> 2] = $sub41;
            var $p_0_in = $cond36;
            var $leader_1 = 0;
          } else {
            var $7 = $cond36 + 4;
            var $or52 = $sub41 | HEAP32[$7 >> 2] & 1 | 2;
            HEAP32[$7 >> 2] = $or52;
            var $9 = $cond36 + ($sub41 + 4);
            var $or56 = HEAP32[$9 >> 2] | 1;
            HEAP32[$9 >> 2] = $or56;
            var $or60 = $sub_ptr_sub39 | HEAP32[$3$s2] & 1 | 2;
            HEAP32[$3$s2] = $or60;
            var $12 = $call21 + ($sub_ptr_sub39 - 4);
            var $or64 = HEAP32[$12 >> 2] | 1;
            HEAP32[$12 >> 2] = $or64;
            var $p_0_in = $cond36;
            var $leader_1 = $call21;
          }
        }
        var $leader_1;
        var $p_0_in;
        var $14 = $p_0_in + 4;
        var $15 = HEAPU32[$14 >> 2];
        var $cmp70 = ($15 & 3) == 0;
        do {
          if ($cmp70) {
            var $trailer_0 = 0;
          } else {
            var $and73 = $15 & -8;
            if ($and73 <= $cond + 16) {
              var $trailer_0 = 0;
              break;
            }
            var $sub77 = $and73 - $cond;
            HEAP32[$14 >> 2] = $cond | $15 & 1 | 2;
            HEAP32[$p_0_in + ($cond | 4) >> 2] = $sub77 | 3;
            var $17 = $p_0_in + ($and73 | 4);
            var $or94 = HEAP32[$17 >> 2] | 1;
            HEAP32[$17 >> 2] = $or94;
            var $trailer_0 = $p_0_in + ($cond + 8);
          }
        } while (0);
        var $trailer_0;
        if ($leader_1 != 0) {
          _free($leader_1);
        }
        if ($trailer_0 != 0) {
          _free($trailer_0);
        }
        var $retval_0 = $p_0_in + 8;
      } else {
        var $call13 = ___errno();
        HEAP32[$call13 >> 2] = 12;
        var $retval_0 = 0;
      }
    }
  } while (0);
  var $retval_0;
  return $retval_0;
  return null;
}

_internal_memalign["X"] = 1;

function _independent_calloc($n_elements, $elem_size, $chunks) {
  var __stackBase__ = STACKTOP;
  STACKTOP += 4;
  var $sz = __stackBase__;
  HEAP32[$sz >> 2] = $elem_size;
  var $call = _ialloc($n_elements, $sz, 3, $chunks);
  STACKTOP = __stackBase__;
  return $call;
  return null;
}

function _ialloc($n_elements, $sizes, $opts, $chunks) {
  var $marray_1$s2;
  var __label__;
  if (HEAP32[_mparams >> 2] == 0) {
    _init_mparams();
  }
  var $cmp1 = $chunks == 0;
  var $cmp2 = $n_elements == 0;
  do {
    if ($cmp1) {
      if ($cmp2) {
        var $call6 = _malloc(0);
        var $retval_0 = $call6;
        __label__ = 29;
        break;
      }
      var $mul = $n_elements << 2;
      if ($mul < 11) {
        var $marray_0 = 0;
        var $array_size_0 = 16;
        __label__ = 8;
        break;
      }
      var $marray_0 = 0;
      var $array_size_0 = $mul + 11 & -8;
      __label__ = 8;
      break;
    } else {
      if ($cmp2) {
        var $retval_0 = $chunks;
        __label__ = 29;
        break;
      }
      var $marray_0 = $chunks;
      var $array_size_0 = 0;
      __label__ = 8;
      break;
    }
  } while (0);
  do {
    if (__label__ == 8) {
      var $array_size_0;
      var $marray_0;
      var $tobool13 = ($opts & 1) == 0;
      $for_cond_preheader$$if_then14$102 : do {
        if ($tobool13) {
          if ($cmp2) {
            var $element_size_0 = 0;
            var $contents_size_1 = 0;
            break;
          }
          var $contents_size_08 = 0;
          var $i_09 = 0;
          while (1) {
            var $i_09;
            var $contents_size_08;
            var $3 = HEAPU32[$sizes + ($i_09 << 2) >> 2];
            if ($3 < 11) {
              var $cond34 = 16;
            } else {
              var $cond34 = $3 + 11 & -8;
            }
            var $cond34;
            var $add35 = $cond34 + $contents_size_08;
            var $inc = $i_09 + 1;
            if ($inc == $n_elements) {
              var $element_size_0 = 0;
              var $contents_size_1 = $add35;
              break $for_cond_preheader$$if_then14$102;
            }
            var $contents_size_08 = $add35;
            var $i_09 = $inc;
          }
        } else {
          var $2 = HEAPU32[$sizes >> 2];
          if ($2 < 11) {
            var $cond22 = 16;
          } else {
            var $cond22 = $2 + 11 & -8;
          }
          var $cond22;
          var $element_size_0 = $cond22;
          var $contents_size_1 = $cond22 * $n_elements;
        }
      } while (0);
      var $contents_size_1;
      var $element_size_0;
      var $call40 = _malloc($array_size_0 - 4 + $contents_size_1);
      if ($call40 == 0) {
        var $retval_0 = 0;
        break;
      }
      var $add_ptr = $call40 - 8;
      var $and48 = HEAP32[$call40 - 4 >> 2] & -8;
      if (($opts & 2) != 0) {
        var $sub53 = -4 - $array_size_0 + $and48;
        _memset($call40, 0, $sub53, 1);
      }
      if ($marray_0 == 0) {
        var $6 = $call40 + $contents_size_1;
        var $or60 = $and48 - $contents_size_1 | 3;
        HEAP32[$call40 + ($contents_size_1 - 4) >> 2] = $or60;
        var $marray_1 = $6, $marray_1$s2 = $marray_1 >> 2;
        var $remainder_size_0 = $contents_size_1;
      } else {
        var $marray_1 = $marray_0, $marray_1$s2 = $marray_1 >> 2;
        var $remainder_size_0 = $and48;
      }
      var $remainder_size_0;
      var $marray_1;
      HEAP32[$marray_1$s2] = $call40;
      var $sub66 = $n_elements - 1;
      var $cmp672 = $sub66 == 0;
      $if_else88$$if_then68_lr_ph$121 : do {
        if ($cmp672) {
          var $p_0_in_lcssa = $add_ptr;
          var $remainder_size_1_lcssa = $remainder_size_0;
        } else {
          if ($element_size_0 == 0) {
            var $p_0_in3_us = $add_ptr;
            var $remainder_size_14_us = $remainder_size_0;
            var $i_15_us = 0;
            while (1) {
              var $i_15_us;
              var $remainder_size_14_us;
              var $p_0_in3_us;
              var $9 = HEAPU32[$sizes + ($i_15_us << 2) >> 2];
              if ($9 < 11) {
                var $size_0_us = 16;
              } else {
                var $size_0_us = $9 + 11 & -8;
              }
              var $size_0_us;
              var $sub83_us = $remainder_size_14_us - $size_0_us;
              HEAP32[$p_0_in3_us + 4 >> 2] = $size_0_us | 3;
              var $add_ptr87_us = $p_0_in3_us + $size_0_us;
              var $inc94_us = $i_15_us + 1;
              HEAP32[($inc94_us << 2 >> 2) + $marray_1$s2] = $p_0_in3_us + ($size_0_us + 8);
              if ($inc94_us == $sub66) {
                var $p_0_in_lcssa = $add_ptr87_us;
                var $remainder_size_1_lcssa = $sub83_us;
                break $if_else88$$if_then68_lr_ph$121;
              }
              var $p_0_in3_us = $add_ptr87_us;
              var $remainder_size_14_us = $sub83_us;
              var $i_15_us = $inc94_us;
            }
          } else {
            var $or85 = $element_size_0 | 3;
            var $add_ptr87_sum = $element_size_0 + 8;
            var $p_0_in3 = $add_ptr;
            var $remainder_size_14 = $remainder_size_0;
            var $i_15 = 0;
            while (1) {
              var $i_15;
              var $remainder_size_14;
              var $p_0_in3;
              var $sub83 = $remainder_size_14 - $element_size_0;
              HEAP32[$p_0_in3 + 4 >> 2] = $or85;
              var $add_ptr87 = $p_0_in3 + $element_size_0;
              var $inc94 = $i_15 + 1;
              HEAP32[($inc94 << 2 >> 2) + $marray_1$s2] = $p_0_in3 + $add_ptr87_sum;
              if ($inc94 == $sub66) {
                var $p_0_in_lcssa = $add_ptr87;
                var $remainder_size_1_lcssa = $sub83;
                break $if_else88$$if_then68_lr_ph$121;
              }
              var $p_0_in3 = $add_ptr87;
              var $remainder_size_14 = $sub83;
              var $i_15 = $inc94;
            }
          }
        }
      } while (0);
      var $remainder_size_1_lcssa;
      var $p_0_in_lcssa;
      HEAP32[$p_0_in_lcssa + 4 >> 2] = $remainder_size_1_lcssa | 3;
      var $retval_0 = $marray_1;
    }
  } while (0);
  var $retval_0;
  return $retval_0;
  return null;
}

_ialloc["X"] = 1;

function _independent_comalloc($n_elements, $sizes, $chunks) {
  var $call = _ialloc($n_elements, $sizes, 0, $chunks);
  return $call;
  return null;
}

function _valloc($bytes) {
  if (HEAP32[_mparams >> 2] == 0) {
    _init_mparams();
  }
  var $1 = HEAP32[_mparams + 4 >> 2];
  var $call1 = _memalign($1, $bytes);
  return $call1;
  return null;
}

function _pvalloc($bytes) {
  if (HEAP32[_mparams >> 2] == 0) {
    _init_mparams();
  }
  var $1 = HEAP32[_mparams + 4 >> 2];
  var $and = $bytes - 1 + $1 & -$1;
  var $call2 = _memalign($1, $and);
  return $call2;
  return null;
}

function _malloc_trim($pad) {
  if (HEAP32[_mparams >> 2] == 0) {
    _init_mparams();
  }
  var $call1 = _sys_trim($pad);
  return $call1;
  return null;
}

function _mallinfo($agg_result) {
  _internal_mallinfo($agg_result);
  return;
  return;
}

function _internal_mallinfo($agg_result) {
  var $agg_result$s2 = $agg_result >> 2;
  if (HEAP32[_mparams >> 2] == 0) {
    _init_mparams();
  }
  var $1 = HEAPU32[__gm_ + 24 >> 2];
  if ($1 == 0) {
    var $nm_0_0 = 0;
    var $nm_1_0 = 0;
    var $nm_9_0 = 0;
    var $nm_8_0 = 0;
    var $nm_4_0 = 0;
    var $nm_5_0 = 0;
    var $nm_7_0 = 0;
  } else {
    var $2 = HEAPU32[__gm_ + 12 >> 2];
    var $add = $2 + 40;
    var $s_01 = __gm_ + 444;
    var $sum_02 = $add;
    var $mfree_03 = $add;
    var $nfree_04 = 1;
    while (1) {
      var $nfree_04;
      var $mfree_03;
      var $sum_02;
      var $s_01;
      var $3 = HEAPU32[$s_01 >> 2];
      var $4 = $3 + 8;
      if (($4 & 7) == 0) {
        var $cond = 0;
      } else {
        var $cond = -$4 & 7;
      }
      var $cond;
      var $size = $s_01 + 4;
      var $q_0_in = $3 + $cond;
      var $nfree_1 = $nfree_04;
      var $mfree_1 = $mfree_03;
      var $sum_1 = $sum_02;
      while (1) {
        var $sum_1;
        var $mfree_1;
        var $nfree_1;
        var $q_0_in;
        if ($q_0_in < $3) {
          break;
        }
        if ($q_0_in >= $3 + HEAP32[$size >> 2] | $q_0_in == $1) {
          break;
        }
        var $8 = HEAP32[$q_0_in + 4 >> 2];
        if ($8 == 7) {
          break;
        }
        var $and22 = $8 & -8;
        var $add23 = $and22 + $sum_1;
        if (($8 & 3) == 1) {
          var $nfree_2 = $nfree_1 + 1;
          var $mfree_2 = $and22 + $mfree_1;
        } else {
          var $nfree_2 = $nfree_1;
          var $mfree_2 = $mfree_1;
        }
        var $mfree_2;
        var $nfree_2;
        var $q_0_in = $q_0_in + $and22;
        var $nfree_1 = $nfree_2;
        var $mfree_1 = $mfree_2;
        var $sum_1 = $add23;
      }
      var $9 = HEAPU32[$s_01 + 8 >> 2];
      if ($9 == 0) {
        break;
      }
      var $s_01 = $9;
      var $sum_02 = $sum_1;
      var $mfree_03 = $mfree_1;
      var $nfree_04 = $nfree_1;
    }
    var $10 = HEAP32[__gm_ + 432 >> 2];
    var $nm_0_0 = $sum_1;
    var $nm_1_0 = $nfree_1;
    var $nm_9_0 = $2;
    var $nm_8_0 = $mfree_1;
    var $nm_4_0 = $10 - $sum_1;
    var $nm_5_0 = HEAP32[__gm_ + 436 >> 2];
    var $nm_7_0 = $10 - $mfree_1;
  }
  var $nm_7_0;
  var $nm_5_0;
  var $nm_4_0;
  var $nm_8_0;
  var $nm_9_0;
  var $nm_1_0;
  var $nm_0_0;
  HEAP32[$agg_result$s2] = $nm_0_0;
  HEAP32[$agg_result$s2 + 1] = $nm_1_0;
  HEAP32[$agg_result$s2 + 2] = 0;
  HEAP32[$agg_result$s2 + 3] = 0;
  HEAP32[$agg_result$s2 + 4] = $nm_4_0;
  HEAP32[$agg_result$s2 + 5] = $nm_5_0;
  HEAP32[$agg_result$s2 + 6] = 0;
  HEAP32[$agg_result$s2 + 7] = $nm_7_0;
  HEAP32[$agg_result$s2 + 8] = $nm_8_0;
  HEAP32[$agg_result$s2 + 9] = $nm_9_0;
  return;
  return;
}

_internal_mallinfo["X"] = 1;

function _malloc_stats() {
  _internal_malloc_stats();
  return;
  return;
}

function _internal_malloc_stats() {
  if (HEAP32[_mparams >> 2] == 0) {
    _init_mparams();
  }
  var $1 = HEAPU32[__gm_ + 24 >> 2];
  var $cmp1 = $1 == 0;
  $if_end33$$if_then$184 : do {
    if ($cmp1) {
      var $maxfp_0 = 0;
      var $fp_0 = 0;
      var $used_3 = 0;
    } else {
      var $2 = HEAP32[__gm_ + 436 >> 2];
      var $3 = HEAPU32[__gm_ + 432 >> 2];
      var $s_01 = __gm_ + 444;
      var $used_02 = $3 - 40 - HEAP32[__gm_ + 12 >> 2];
      while (1) {
        var $used_02;
        var $s_01;
        var $5 = HEAPU32[$s_01 >> 2];
        var $6 = $5 + 8;
        if (($6 & 7) == 0) {
          var $cond = 0;
        } else {
          var $cond = -$6 & 7;
        }
        var $cond;
        var $size = $s_01 + 4;
        var $q_0_in = $5 + $cond;
        var $used_1 = $used_02;
        while (1) {
          var $used_1;
          var $q_0_in;
          if ($q_0_in < $5) {
            break;
          }
          if ($q_0_in >= $5 + HEAP32[$size >> 2] | $q_0_in == $1) {
            break;
          }
          var $10 = HEAP32[$q_0_in + 4 >> 2];
          if ($10 == 7) {
            break;
          }
          var $and27 = $10 & -8;
          var $sub28 = ($10 & 3) == 1 ? $and27 : 0;
          var $used_2 = $used_1 - $sub28;
          var $q_0_in = $q_0_in + $and27;
          var $used_1 = $used_2;
        }
        var $11 = HEAPU32[$s_01 + 8 >> 2];
        if ($11 == 0) {
          var $maxfp_0 = $2;
          var $fp_0 = $3;
          var $used_3 = $used_1;
          break $if_end33$$if_then$184;
        }
        var $s_01 = $11;
        var $used_02 = $used_1;
      }
    }
  } while (0);
  var $used_3;
  var $fp_0;
  var $maxfp_0;
  var $13 = HEAP32[HEAP32[__impure_ptr >> 2] + 12 >> 2];
  var $call34 = _fprintf($13, STRING_TABLE.__str, (tempInt = STACKTOP, STACKTOP += 4, HEAP32[tempInt >> 2] = $maxfp_0, tempInt));
  var $15 = HEAP32[HEAP32[__impure_ptr >> 2] + 12 >> 2];
  var $call36 = _fprintf($15, STRING_TABLE.__str1, (tempInt = STACKTOP, STACKTOP += 4, HEAP32[tempInt >> 2] = $fp_0, tempInt));
  var $17 = HEAP32[HEAP32[__impure_ptr >> 2] + 12 >> 2];
  var $call38 = _fprintf($17, STRING_TABLE.__str2, (tempInt = STACKTOP, STACKTOP += 4, HEAP32[tempInt >> 2] = $used_3, tempInt));
  return;
  return;
}

_internal_malloc_stats["X"] = 1;

function _mallopt($param_number, $value) {
  var $call = _change_mparam($param_number, $value);
  return $call;
  return null;
}

function _internal_realloc($oldmem, $bytes) {
  var $5$s2;
  var $1$s2;
  var __label__;
  var $cmp = $bytes > 4294967231;
  $if_then$$if_end$22 : do {
    if ($cmp) {
      var $call = ___errno();
      HEAP32[$call >> 2] = 12;
      var $retval_0 = 0;
    } else {
      var $add_ptr = $oldmem - 8;
      var $0 = $add_ptr;
      var $1$s2 = $oldmem - 4 >> 2;
      var $2 = HEAPU32[$1$s2];
      var $and = $2 & -8;
      var $add_ptr_sum = $and - 8;
      var $3 = $oldmem + $add_ptr_sum;
      var $cmp2 = $add_ptr < HEAPU32[__gm_ + 16 >> 2];
      do {
        if (!$cmp2) {
          var $and4 = $2 & 3;
          if (!($and4 != 1 & $add_ptr_sum > -8)) {
            break;
          }
          var $5$s2 = $oldmem + ($and - 4) >> 2;
          if ((HEAP32[$5$s2] & 1) == 0) {
            break;
          }
          if ($bytes < 11) {
            var $cond = 16;
          } else {
            var $cond = $bytes + 11 & -8;
          }
          var $cond;
          var $cmp17 = $and4 == 0;
          do {
            if ($cmp17) {
              var $call19 = _mmap_resize($0, $cond);
              var $extra_0 = 0;
              var $newp_0 = $call19;
              __label__ = 16;
              break;
            }
            if ($and < $cond) {
              if ($3 != HEAP32[__gm_ + 24 >> 2]) {
                __label__ = 20;
                break;
              }
              var $add43 = HEAP32[__gm_ + 12 >> 2] + $and;
              if ($add43 <= $cond) {
                __label__ = 20;
                break;
              }
              var $sub48 = $add43 - $cond;
              var $11 = $oldmem + ($cond - 8);
              HEAP32[$1$s2] = $cond | $2 & 1 | 2;
              var $or58 = $sub48 | 1;
              HEAP32[$oldmem + ($cond - 4) >> 2] = $or58;
              HEAP32[__gm_ + 24 >> 2] = $11;
              HEAP32[__gm_ + 12 >> 2] = $sub48;
              var $extra_0 = 0;
              var $newp_0 = $0;
              __label__ = 16;
              break;
            }
            var $sub = $and - $cond;
            if ($sub <= 15) {
              var $extra_0 = 0;
              var $newp_0 = $0;
              __label__ = 16;
              break;
            }
            HEAP32[$1$s2] = $cond | $2 & 1 | 2;
            HEAP32[$oldmem + ($cond - 4) >> 2] = $sub | 3;
            var $or37 = HEAP32[$5$s2] | 1;
            HEAP32[$5$s2] = $or37;
            var $extra_0 = $oldmem + $cond;
            var $newp_0 = $0;
            __label__ = 16;
            break;
          } while (0);
          do {
            if (__label__ == 16) {
              var $newp_0;
              var $extra_0;
              if ($newp_0 == 0) {
                break;
              }
              if ($extra_0 != 0) {
                _free($extra_0);
              }
              var $retval_0 = $newp_0 + 8;
              break $if_then$$if_end$22;
            }
          } while (0);
          var $call74 = _malloc($bytes);
          if ($call74 == 0) {
            var $retval_0 = 0;
            break $if_then$$if_end$22;
          }
          var $cond80 = (HEAP32[$1$s2] & 3) == 0 ? 8 : 4;
          var $sub81 = $and - $cond80;
          var $cond86 = $sub81 < $bytes ? $sub81 : $bytes;
          _memcpy($call74, $oldmem, $cond86, 1);
          _free($oldmem);
          var $retval_0 = $call74;
          break $if_then$$if_end$22;
        }
      } while (0);
      _abort();
      throw "Reached an unreachable!";
    }
  } while (0);
  var $retval_0;
  return $retval_0;
  return null;
}

_internal_realloc["X"] = 1;

function _init_mparams() {
  if (HEAP32[_mparams >> 2] == 0) {
    var $call = _sysconf(8);
    if (($call - 1 & $call) == 0) {
      HEAP32[_mparams + 8 >> 2] = $call;
      HEAP32[_mparams + 4 >> 2] = $call;
      HEAP32[_mparams + 12 >> 2] = -1;
      HEAP32[_mparams + 16 >> 2] = 2097152;
      HEAP32[_mparams + 20 >> 2] = 0;
      HEAP32[__gm_ + 440 >> 2] = 0;
      var $call6 = _time(0);
      HEAP32[_mparams >> 2] = $call6 & -16 ^ 1431655768;
    } else {
      _abort();
      throw "Reached an unreachable!";
    }
  }
  return;
  return;
}

function _malloc_usable_size($mem) {
  var $cmp = $mem == 0;
  do {
    if ($cmp) {
      var $retval_0 = 0;
    } else {
      var $1 = HEAP32[$mem - 4 >> 2];
      var $and = $1 & 3;
      if ($and == 1) {
        var $retval_0 = 0;
        break;
      }
      var $cond = $and == 0 ? 8 : 4;
      var $retval_0 = ($1 & -8) - $cond;
    }
  } while (0);
  var $retval_0;
  return $retval_0;
  return null;
}

function _mmap_resize($oldp, $nb) {
  var $and = HEAP32[$oldp + 4 >> 2] & -8;
  var $cmp = $nb < 256;
  do {
    if ($cmp) {
      var $retval_0 = 0;
    } else {
      if ($and >= $nb + 4) {
        if ($and - $nb <= HEAP32[_mparams + 8 >> 2] << 1) {
          var $retval_0 = $oldp;
          break;
        }
      }
      var $retval_0 = 0;
    }
  } while (0);
  var $retval_0;
  return $retval_0;
  return null;
}

function _segment_holding($addr) {
  var $sp_0$s2;
  var $sp_0 = __gm_ + 444, $sp_0$s2 = $sp_0 >> 2;
  while (1) {
    var $sp_0;
    var $0 = HEAPU32[$sp_0$s2];
    if ($0 <= $addr) {
      if ($0 + HEAP32[$sp_0$s2 + 1] > $addr) {
        var $retval_0 = $sp_0;
        break;
      }
    }
    var $2 = HEAPU32[$sp_0$s2 + 2];
    if ($2 == 0) {
      var $retval_0 = 0;
      break;
    }
    var $sp_0 = $2, $sp_0$s2 = $sp_0 >> 2;
  }
  var $retval_0;
  return $retval_0;
  return null;
}

function _init_top($p, $psize) {
  var $0 = $p;
  var $1 = $p + 8;
  if (($1 & 7) == 0) {
    var $cond = 0;
  } else {
    var $cond = -$1 & 7;
  }
  var $cond;
  var $sub5 = $psize - $cond;
  HEAP32[__gm_ + 24 >> 2] = $0 + $cond;
  HEAP32[__gm_ + 12 >> 2] = $sub5;
  HEAP32[$0 + ($cond + 4) >> 2] = $sub5 | 1;
  HEAP32[$0 + ($psize + 4) >> 2] = 40;
  var $6 = HEAP32[_mparams + 16 >> 2];
  HEAP32[__gm_ + 28 >> 2] = $6;
  return;
  return;
}

function _init_bins() {
  var $i_02 = 0;
  while (1) {
    var $i_02;
    var $shl = $i_02 << 1;
    var $0 = ($shl << 2) + __gm_ + 40;
    HEAP32[__gm_ + ($shl + 3 << 2) + 40 >> 2] = $0;
    HEAP32[__gm_ + ($shl + 2 << 2) + 40 >> 2] = $0;
    var $inc = $i_02 + 1;
    if ($inc == 32) {
      break;
    }
    var $i_02 = $inc;
  }
  return;
  return;
}

function _change_mparam($param_number, $value) {
  var __label__;
  if (HEAP32[_mparams >> 2] == 0) {
    _init_mparams();
  } else {
    __label__ = 2;
  }
  do {
    if ($param_number == -1) {
      HEAP32[_mparams + 16 >> 2] = $value;
      var $retval_0 = 1;
    } else if ($param_number == -2) {
      if (HEAPU32[_mparams + 4 >> 2] > $value) {
        var $retval_0 = 0;
        break;
      }
      if (($value - 1 & $value) != 0) {
        var $retval_0 = 0;
        break;
      }
      HEAP32[_mparams + 8 >> 2] = $value;
      var $retval_0 = 1;
    } else if ($param_number == -3) {
      HEAP32[_mparams + 12 >> 2] = $value;
      var $retval_0 = 1;
    } else {
      var $retval_0 = 0;
    }
  } while (0);
  var $retval_0;
  return $retval_0;
  return null;
}

function _prepend_alloc($newbase, $oldbase, $nb) {
  var $R_1$s2;
  var $add_ptr4_sum$s2;
  var $cond15$s2;
  var $oldbase$s2 = $oldbase >> 2;
  var $newbase$s2 = $newbase >> 2;
  var __label__;
  var $0 = $newbase + 8;
  if (($0 & 7) == 0) {
    var $cond = 0;
  } else {
    var $cond = -$0 & 7;
  }
  var $cond;
  var $2 = $oldbase + 8;
  if (($2 & 7) == 0) {
    var $cond15 = 0, $cond15$s2 = $cond15 >> 2;
  } else {
    var $cond15 = -$2 & 7, $cond15$s2 = $cond15 >> 2;
  }
  var $cond15;
  var $add_ptr16 = $oldbase + $cond15;
  var $4 = $add_ptr16;
  var $add_ptr4_sum = $cond + $nb, $add_ptr4_sum$s2 = $add_ptr4_sum >> 2;
  var $add_ptr17 = $newbase + $add_ptr4_sum;
  var $5 = $add_ptr17;
  var $sub18 = $add_ptr16 - ($newbase + $cond) - $nb;
  HEAP32[($cond + 4 >> 2) + $newbase$s2] = $nb | 3;
  var $cmp20 = $4 == HEAP32[__gm_ + 24 >> 2];
  $if_then$$if_else$46 : do {
    if ($cmp20) {
      var $add = HEAP32[__gm_ + 12 >> 2] + $sub18;
      HEAP32[__gm_ + 12 >> 2] = $add;
      HEAP32[__gm_ + 24 >> 2] = $5;
      var $or22 = $add | 1;
      HEAP32[$newbase$s2 + ($add_ptr4_sum$s2 + 1)] = $or22;
    } else {
      if ($4 == HEAP32[__gm_ + 20 >> 2]) {
        var $add26 = HEAP32[__gm_ + 8 >> 2] + $sub18;
        HEAP32[__gm_ + 8 >> 2] = $add26;
        HEAP32[__gm_ + 20 >> 2] = $5;
        var $or28 = $add26 | 1;
        HEAP32[$newbase$s2 + ($add_ptr4_sum$s2 + 1)] = $or28;
        var $prev_foot = $newbase + $add26 + $add_ptr4_sum;
        HEAP32[$prev_foot >> 2] = $add26;
      } else {
        var $14 = HEAPU32[$oldbase$s2 + ($cond15$s2 + 1)];
        if (($14 & 3) == 1) {
          var $and37 = $14 & -8;
          var $shr = $14 >>> 3;
          var $cmp38 = $14 < 256;
          $if_then39$$if_else59$54 : do {
            if ($cmp38) {
              var $16 = HEAPU32[(($cond15 | 8) >> 2) + $oldbase$s2];
              var $18 = HEAPU32[$oldbase$s2 + ($cond15$s2 + 3)];
              if ($16 == $18) {
                var $and43 = HEAP32[__gm_ >> 2] & (1 << $shr ^ -1);
                HEAP32[__gm_ >> 2] = $and43;
              } else {
                var $21 = (($14 >>> 2 & 1073741822) << 2) + __gm_ + 40;
                var $cmp46 = $16 == $21;
                do {
                  if ($cmp46) {
                    __label__ = 14;
                  } else {
                    if ($16 < HEAPU32[__gm_ + 16 >> 2]) {
                      __label__ = 17;
                      break;
                    }
                    __label__ = 14;
                    break;
                  }
                } while (0);
                do {
                  if (__label__ == 14) {
                    if ($18 != $21) {
                      if ($18 < HEAPU32[__gm_ + 16 >> 2]) {
                        break;
                      }
                    }
                    HEAP32[$16 + 12 >> 2] = $18;
                    HEAP32[$18 + 8 >> 2] = $16;
                    break $if_then39$$if_else59$54;
                  }
                } while (0);
                _abort();
                throw "Reached an unreachable!";
              }
            } else {
              var $26 = $add_ptr16;
              var $28 = HEAPU32[(($cond15 | 24) >> 2) + $oldbase$s2];
              var $30 = HEAPU32[$oldbase$s2 + ($cond15$s2 + 3)];
              var $cmp61 = $30 == $26;
              do {
                if ($cmp61) {
                  var $add_ptr16_sum56 = $cond15 | 16;
                  var $35 = $oldbase + ($add_ptr16_sum56 + 4);
                  var $36 = HEAP32[$35 >> 2];
                  if ($36 == 0) {
                    var $arrayidx81 = $oldbase + $add_ptr16_sum56;
                    var $37 = HEAP32[$arrayidx81 >> 2];
                    if ($37 == 0) {
                      var $R_1 = 0, $R_1$s2 = $R_1 >> 2;
                      break;
                    }
                    var $RP_0 = $arrayidx81;
                    var $R_0 = $37;
                  } else {
                    var $RP_0 = $35;
                    var $R_0 = $36;
                    __label__ = 24;
                  }
                  while (1) {
                    var $R_0;
                    var $RP_0;
                    var $arrayidx86 = $R_0 + 20;
                    var $38 = HEAP32[$arrayidx86 >> 2];
                    if ($38 != 0) {
                      var $RP_0 = $arrayidx86;
                      var $R_0 = $38;
                      continue;
                    }
                    var $arrayidx91 = $R_0 + 16;
                    var $39 = HEAPU32[$arrayidx91 >> 2];
                    if ($39 == 0) {
                      break;
                    }
                    var $RP_0 = $arrayidx91;
                    var $R_0 = $39;
                  }
                  if ($RP_0 < HEAPU32[__gm_ + 16 >> 2]) {
                    _abort();
                    throw "Reached an unreachable!";
                  } else {
                    HEAP32[$RP_0 >> 2] = 0;
                    var $R_1 = $R_0, $R_1$s2 = $R_1 >> 2;
                  }
                } else {
                  var $32 = HEAPU32[(($cond15 | 8) >> 2) + $oldbase$s2];
                  if ($32 < HEAPU32[__gm_ + 16 >> 2]) {
                    _abort();
                    throw "Reached an unreachable!";
                  } else {
                    HEAP32[$32 + 12 >> 2] = $30;
                    HEAP32[$30 + 8 >> 2] = $32;
                    var $R_1 = $30, $R_1$s2 = $R_1 >> 2;
                  }
                }
              } while (0);
              var $R_1;
              if ($28 == 0) {
                break;
              }
              var $42 = $oldbase + ($cond15 + 28);
              var $arrayidx108 = (HEAP32[$42 >> 2] << 2) + __gm_ + 304;
              var $cmp109 = $26 == HEAP32[$arrayidx108 >> 2];
              do {
                if ($cmp109) {
                  HEAP32[$arrayidx108 >> 2] = $R_1;
                  if ($R_1 != 0) {
                    break;
                  }
                  var $and118 = HEAP32[__gm_ + 4 >> 2] & (1 << HEAP32[$42 >> 2] ^ -1);
                  HEAP32[__gm_ + 4 >> 2] = $and118;
                  break $if_then39$$if_else59$54;
                }
                if ($28 < HEAPU32[__gm_ + 16 >> 2]) {
                  _abort();
                  throw "Reached an unreachable!";
                } else {
                  var $arrayidx128 = $28 + 16;
                  if (HEAP32[$arrayidx128 >> 2] == $26) {
                    HEAP32[$arrayidx128 >> 2] = $R_1;
                  } else {
                    HEAP32[$28 + 20 >> 2] = $R_1;
                  }
                  if ($R_1 == 0) {
                    break $if_then39$$if_else59$54;
                  }
                }
              } while (0);
              if ($R_1 < HEAPU32[__gm_ + 16 >> 2]) {
                _abort();
                throw "Reached an unreachable!";
              } else {
                HEAP32[$R_1$s2 + 6] = $28;
                var $add_ptr16_sum2627 = $cond15 | 16;
                var $52 = HEAPU32[($add_ptr16_sum2627 >> 2) + $oldbase$s2];
                if ($52 != 0) {
                  if ($52 < HEAPU32[__gm_ + 16 >> 2]) {
                    _abort();
                    throw "Reached an unreachable!";
                  } else {
                    HEAP32[$R_1$s2 + 4] = $52;
                    HEAP32[$52 + 24 >> 2] = $R_1;
                  }
                }
                var $56 = HEAPU32[($add_ptr16_sum2627 + 4 >> 2) + $oldbase$s2];
                if ($56 == 0) {
                  break;
                }
                if ($56 < HEAPU32[__gm_ + 16 >> 2]) {
                  _abort();
                  throw "Reached an unreachable!";
                } else {
                  HEAP32[$R_1$s2 + 5] = $56;
                  HEAP32[$56 + 24 >> 2] = $R_1;
                }
              }
            }
          } while (0);
          var $oldfirst_0 = $oldbase + ($and37 | $cond15);
          var $qsize_0 = $and37 + $sub18;
        } else {
          var $oldfirst_0 = $4;
          var $qsize_0 = $sub18;
        }
        var $qsize_0;
        var $oldfirst_0;
        var $head193 = $oldfirst_0 + 4;
        var $and194 = HEAP32[$head193 >> 2] & -2;
        HEAP32[$head193 >> 2] = $and194;
        HEAP32[$newbase$s2 + ($add_ptr4_sum$s2 + 1)] = $qsize_0 | 1;
        HEAP32[($qsize_0 >> 2) + $newbase$s2 + $add_ptr4_sum$s2] = $qsize_0;
        if ($qsize_0 < 256) {
          var $shl206 = $qsize_0 >>> 2 & 1073741822;
          var $63 = ($shl206 << 2) + __gm_ + 40;
          var $64 = HEAPU32[__gm_ >> 2];
          var $shl211 = 1 << ($qsize_0 >>> 3);
          var $tobool213 = ($64 & $shl211) == 0;
          do {
            if ($tobool213) {
              HEAP32[__gm_ >> 2] = $64 | $shl211;
              var $F209_0 = $63;
              var $_pre_phi = ($shl206 + 2 << 2) + __gm_ + 40;
            } else {
              var $65 = ($shl206 + 2 << 2) + __gm_ + 40;
              var $66 = HEAPU32[$65 >> 2];
              if ($66 >= HEAPU32[__gm_ + 16 >> 2]) {
                var $F209_0 = $66;
                var $_pre_phi = $65;
                break;
              }
              _abort();
              throw "Reached an unreachable!";
            }
          } while (0);
          var $_pre_phi;
          var $F209_0;
          HEAP32[$_pre_phi >> 2] = $5;
          HEAP32[$F209_0 + 12 >> 2] = $5;
          HEAP32[$newbase$s2 + ($add_ptr4_sum$s2 + 2)] = $F209_0;
          HEAP32[$newbase$s2 + ($add_ptr4_sum$s2 + 3)] = $63;
        } else {
          var $71 = $add_ptr17;
          var $shr238 = $qsize_0 >>> 8;
          var $cmp239 = $shr238 == 0;
          do {
            if ($cmp239) {
              var $I237_0 = 0;
            } else {
              if ($qsize_0 > 16777215) {
                var $I237_0 = 31;
                break;
              }
              var $and249 = $shr238 + 1048320 >>> 16 & 8;
              var $shl250 = $shr238 << $and249;
              var $and253 = $shl250 + 520192 >>> 16 & 4;
              var $shl255 = $shl250 << $and253;
              var $and258 = $shl255 + 245760 >>> 16 & 2;
              var $add263 = 14 - ($and253 | $and249 | $and258) + ($shl255 << $and258 >>> 15);
              var $I237_0 = $qsize_0 >>> $add263 + 7 & 1 | $add263 << 1;
            }
          } while (0);
          var $I237_0;
          var $arrayidx272 = ($I237_0 << 2) + __gm_ + 304;
          HEAP32[$newbase$s2 + ($add_ptr4_sum$s2 + 7)] = $I237_0;
          var $child274 = $newbase + ($add_ptr4_sum + 16);
          HEAP32[$newbase$s2 + ($add_ptr4_sum$s2 + 5)] = 0;
          HEAP32[$child274 >> 2] = 0;
          var $74 = HEAP32[__gm_ + 4 >> 2];
          var $shl279 = 1 << $I237_0;
          if (($74 & $shl279) == 0) {
            var $or285 = $74 | $shl279;
            HEAP32[__gm_ + 4 >> 2] = $or285;
            HEAP32[$arrayidx272 >> 2] = $71;
            HEAP32[$newbase$s2 + ($add_ptr4_sum$s2 + 6)] = $arrayidx272;
            HEAP32[$newbase$s2 + ($add_ptr4_sum$s2 + 3)] = $71;
            HEAP32[$newbase$s2 + ($add_ptr4_sum$s2 + 2)] = $71;
          } else {
            if ($I237_0 == 31) {
              var $cond300 = 0;
            } else {
              var $cond300 = 25 - ($I237_0 >>> 1);
            }
            var $cond300;
            var $K290_0 = $qsize_0 << $cond300;
            var $T_0 = HEAP32[$arrayidx272 >> 2];
            while (1) {
              var $T_0;
              var $K290_0;
              if ((HEAP32[$T_0 + 4 >> 2] & -8) == $qsize_0) {
                var $fd329 = $T_0 + 8;
                var $87 = HEAPU32[$fd329 >> 2];
                var $89 = HEAPU32[__gm_ + 16 >> 2];
                var $cmp331 = $T_0 < $89;
                do {
                  if (!$cmp331) {
                    if ($87 < $89) {
                      break;
                    }
                    HEAP32[$87 + 12 >> 2] = $71;
                    HEAP32[$fd329 >> 2] = $71;
                    HEAP32[$newbase$s2 + ($add_ptr4_sum$s2 + 2)] = $87;
                    HEAP32[$newbase$s2 + ($add_ptr4_sum$s2 + 3)] = $T_0;
                    HEAP32[$newbase$s2 + ($add_ptr4_sum$s2 + 6)] = 0;
                    break $if_then$$if_else$46;
                  }
                } while (0);
                _abort();
                throw "Reached an unreachable!";
              } else {
                var $arrayidx310 = ($K290_0 >>> 31 << 2) + $T_0 + 16;
                var $81 = HEAPU32[$arrayidx310 >> 2];
                if ($81 == 0) {
                  if ($arrayidx310 >= HEAPU32[__gm_ + 16 >> 2]) {
                    HEAP32[$arrayidx310 >> 2] = $71;
                    HEAP32[$newbase$s2 + ($add_ptr4_sum$s2 + 6)] = $T_0;
                    HEAP32[$newbase$s2 + ($add_ptr4_sum$s2 + 3)] = $71;
                    HEAP32[$newbase$s2 + ($add_ptr4_sum$s2 + 2)] = $71;
                    break $if_then$$if_else$46;
                  }
                  _abort();
                  throw "Reached an unreachable!";
                } else {
                  var $K290_0 = $K290_0 << 1;
                  var $T_0 = $81;
                }
              }
            }
          }
        }
      }
    }
  } while (0);
  return $newbase + ($cond | 8);
  return null;
}

_prepend_alloc["X"] = 1;

function __ZNKSt9bad_alloc4whatEv($this) {
  return STRING_TABLE.__str3;
  return null;
}

function __ZNKSt20bad_array_new_length4whatEv($this) {
  return STRING_TABLE.__str14;
  return null;
}

function __ZSt15get_new_handlerv() {
  var $0 = (tempValue = HEAP32[__ZL13__new_handler >> 2], HEAP32[__ZL13__new_handler >> 2] = tempValue, tempValue);
  return $0;
  return null;
}

function __ZSt15set_new_handlerPFvvE($handler) {
  var $0 = $handler;
  var $1 = (tempValue = HEAP32[__ZL13__new_handler >> 2], HEAP32[__ZL13__new_handler >> 2] = $0, tempValue);
  return $1;
  return null;
}

function __ZNSt9bad_allocC2Ev($this) {
  HEAP32[$this >> 2] = __ZTVSt9bad_alloc + 8;
  return;
  return;
}

function __ZdlPv($ptr) {
  if ($ptr != 0) {
    _free($ptr);
  }
  return;
  return;
}

function __ZdlPvRKSt9nothrow_t($ptr, $0) {
  __ZdlPv($ptr);
  return;
  return;
}

function __ZdaPv($ptr) {
  __ZdlPv($ptr);
  return;
  return;
}

function __ZdaPvRKSt9nothrow_t($ptr, $0) {
  __ZdaPv($ptr);
  return;
  return;
}

function __ZNSt9bad_allocD0Ev($this) {
  __ZNSt9bad_allocD2Ev($this);
  var $0 = $this;
  __ZdlPv($0);
  return;
  return;
}

function __ZNSt9bad_allocD2Ev($this) {
  var $0 = $this;
  __ZNSt9exceptionD2Ev($0);
  return;
  return;
}

function __ZNSt20bad_array_new_lengthC2Ev($this) {
  var $0 = $this;
  __ZNSt9bad_allocC2Ev($0);
  HEAP32[$this >> 2] = __ZTVSt20bad_array_new_length + 8;
  return;
  return;
}

function __ZNSt20bad_array_new_lengthD0Ev($this) {
  var $0 = $this;
  __ZNSt9bad_allocD2Ev($0);
  var $1 = $this;
  __ZdlPv($1);
  return;
  return;
}

function _add_segment($tbase, $tsize) {
  var $add_ptr14$s2;
  var $0$s2;
  var $0 = HEAPU32[__gm_ + 24 >> 2], $0$s2 = $0 >> 2;
  var $1 = $0;
  var $call = _segment_holding($1);
  var $2 = HEAP32[$call >> 2];
  var $3 = HEAP32[$call + 4 >> 2];
  var $add_ptr = $2 + $3;
  var $4 = $2 + ($3 - 39);
  if (($4 & 7) == 0) {
    var $cond = 0;
  } else {
    var $cond = -$4 & 7;
  }
  var $cond;
  var $add_ptr7 = $2 + ($3 - 47) + $cond;
  var $cond13 = $add_ptr7 < $0 + 16 ? $1 : $add_ptr7;
  var $add_ptr14 = $cond13 + 8, $add_ptr14$s2 = $add_ptr14 >> 2;
  var $7 = $add_ptr14;
  var $8 = $tbase;
  var $sub16 = $tsize - 40;
  _init_top($8, $sub16);
  var $9 = $cond13 + 4;
  HEAP32[$9 >> 2] = 27;
  HEAP32[$add_ptr14$s2] = HEAP32[__gm_ + 444 >> 2];
  HEAP32[$add_ptr14$s2 + 1] = HEAP32[__gm_ + 448 >> 2];
  HEAP32[$add_ptr14$s2 + 2] = HEAP32[__gm_ + 452 >> 2];
  HEAP32[$add_ptr14$s2 + 3] = HEAP32[__gm_ + 456 >> 2];
  HEAP32[__gm_ + 444 >> 2] = $tbase;
  HEAP32[__gm_ + 448 >> 2] = $tsize;
  HEAP32[__gm_ + 456 >> 2] = 0;
  HEAP32[__gm_ + 452 >> 2] = $7;
  var $10 = $cond13 + 28;
  HEAP32[$10 >> 2] = 7;
  var $cmp2711 = $cond13 + 32 < $add_ptr;
  $if_then$$for_end$5 : do {
    if ($cmp2711) {
      var $add_ptr2412 = $10;
      while (1) {
        var $add_ptr2412;
        var $12 = $add_ptr2412 + 4;
        HEAP32[$12 >> 2] = 7;
        if ($add_ptr2412 + 8 >= $add_ptr) {
          break $if_then$$for_end$5;
        }
        var $add_ptr2412 = $12;
      }
    }
  } while (0);
  var $cmp28 = $cond13 == $1;
  $if_end165$$if_then29$9 : do {
    if (!$cmp28) {
      var $sub_ptr_sub = $cond13 - $0;
      var $add_ptr30 = $1 + $sub_ptr_sub;
      var $15 = $1 + ($sub_ptr_sub + 4);
      var $and32 = HEAP32[$15 >> 2] & -2;
      HEAP32[$15 >> 2] = $and32;
      var $or33 = $sub_ptr_sub | 1;
      HEAP32[$0$s2 + 1] = $or33;
      var $prev_foot = $add_ptr30;
      HEAP32[$prev_foot >> 2] = $sub_ptr_sub;
      if ($sub_ptr_sub < 256) {
        var $shl = $sub_ptr_sub >>> 2 & 1073741822;
        var $18 = ($shl << 2) + __gm_ + 40;
        var $19 = HEAPU32[__gm_ >> 2];
        var $shl39 = 1 << ($sub_ptr_sub >>> 3);
        var $tobool = ($19 & $shl39) == 0;
        do {
          if ($tobool) {
            var $or44 = $19 | $shl39;
            HEAP32[__gm_ >> 2] = $or44;
            var $F_0 = $18;
            var $_pre_phi = ($shl + 2 << 2) + __gm_ + 40;
          } else {
            var $20 = ($shl + 2 << 2) + __gm_ + 40;
            var $21 = HEAPU32[$20 >> 2];
            if ($21 >= HEAPU32[__gm_ + 16 >> 2]) {
              var $F_0 = $21;
              var $_pre_phi = $20;
              break;
            }
            _abort();
            throw "Reached an unreachable!";
          }
        } while (0);
        var $_pre_phi;
        var $F_0;
        HEAP32[$_pre_phi >> 2] = $0;
        HEAP32[$F_0 + 12 >> 2] = $0;
        HEAP32[$0$s2 + 2] = $F_0;
        HEAP32[$0$s2 + 3] = $18;
      } else {
        var $24 = $0;
        var $shr58 = $sub_ptr_sub >>> 8;
        var $cmp59 = $shr58 == 0;
        do {
          if ($cmp59) {
            var $I57_0 = 0;
          } else {
            if ($sub_ptr_sub > 16777215) {
              var $I57_0 = 31;
              break;
            }
            var $and69 = $shr58 + 1048320 >>> 16 & 8;
            var $shl70 = $shr58 << $and69;
            var $and73 = $shl70 + 520192 >>> 16 & 4;
            var $shl75 = $shl70 << $and73;
            var $and78 = $shl75 + 245760 >>> 16 & 2;
            var $add83 = 14 - ($and73 | $and69 | $and78) + ($shl75 << $and78 >>> 15);
            var $I57_0 = $sub_ptr_sub >>> $add83 + 7 & 1 | $add83 << 1;
          }
        } while (0);
        var $I57_0;
        var $arrayidx91 = ($I57_0 << 2) + __gm_ + 304;
        HEAP32[$0$s2 + 7] = $I57_0;
        HEAP32[$0$s2 + 5] = 0;
        HEAP32[$0$s2 + 4] = 0;
        var $26 = HEAP32[__gm_ + 4 >> 2];
        var $shl95 = 1 << $I57_0;
        if (($26 & $shl95) == 0) {
          var $or101 = $26 | $shl95;
          HEAP32[__gm_ + 4 >> 2] = $or101;
          HEAP32[$arrayidx91 >> 2] = $24;
          HEAP32[$0$s2 + 6] = $arrayidx91;
          HEAP32[$0$s2 + 3] = $0;
          HEAP32[$0$s2 + 2] = $0;
        } else {
          if ($I57_0 == 31) {
            var $cond115 = 0;
          } else {
            var $cond115 = 25 - ($I57_0 >>> 1);
          }
          var $cond115;
          var $K105_0 = $sub_ptr_sub << $cond115;
          var $T_0 = HEAP32[$arrayidx91 >> 2];
          while (1) {
            var $T_0;
            var $K105_0;
            if ((HEAP32[$T_0 + 4 >> 2] & -8) == $sub_ptr_sub) {
              var $fd145 = $T_0 + 8;
              var $32 = HEAPU32[$fd145 >> 2];
              var $34 = HEAPU32[__gm_ + 16 >> 2];
              var $cmp147 = $T_0 < $34;
              do {
                if (!$cmp147) {
                  if ($32 < $34) {
                    break;
                  }
                  HEAP32[$32 + 12 >> 2] = $24;
                  HEAP32[$fd145 >> 2] = $24;
                  HEAP32[$0$s2 + 2] = $32;
                  HEAP32[$0$s2 + 3] = $T_0;
                  HEAP32[$0$s2 + 6] = 0;
                  break $if_end165$$if_then29$9;
                }
              } while (0);
              _abort();
              throw "Reached an unreachable!";
            } else {
              var $arrayidx126 = ($K105_0 >>> 31 << 2) + $T_0 + 16;
              var $29 = HEAPU32[$arrayidx126 >> 2];
              if ($29 == 0) {
                if ($arrayidx126 >= HEAPU32[__gm_ + 16 >> 2]) {
                  HEAP32[$arrayidx126 >> 2] = $24;
                  HEAP32[$0$s2 + 6] = $T_0;
                  HEAP32[$0$s2 + 3] = $0;
                  HEAP32[$0$s2 + 2] = $0;
                  break $if_end165$$if_then29$9;
                }
                _abort();
                throw "Reached an unreachable!";
              } else {
                var $K105_0 = $K105_0 << 1;
                var $T_0 = $29;
              }
            }
          }
        }
      }
    }
  } while (0);
  return;
  return;
}

_add_segment["X"] = 1;

function __Znwj($size) {
  var $size_addr_0_ph = $size == 0 ? 1 : $size;
  while (1) {
    var $call = _malloc($size_addr_0_ph);
    if ($call == 0) {
      var $call2 = __ZSt15get_new_handlerv();
      if ($call2 == 0) {
        var $exception = ___cxa_allocate_exception(4);
        var $2 = $exception;
        __ZNSt9bad_allocC2Ev($2);
        ___cxa_throw($exception, __ZTISt9bad_alloc, 2);
        throw "Reached an unreachable!";
      } else {
        FUNCTION_TABLE[$call2]();
      }
    } else {
      return $call;
    }
  }
  return null;
}

function __ZnwjRKSt9nothrow_t($size, $0) {
  var $call = __Znwj($size);
  var $p_0 = $call;
  var $p_0;
  return $p_0;
  return null;
}

function __Znaj($size) {
  var $call = __Znwj($size);
  return $call;
  return null;
}

function __ZnajRKSt9nothrow_t($size, $nothrow) {
  var $call = __Znaj($size);
  var $p_0 = $call;
  var $p_0;
  return $p_0;
  return null;
}

function __ZSt17__throw_bad_allocv() {
  var $exception = ___cxa_allocate_exception(4);
  var $0 = $exception;
  __ZNSt9bad_allocC2Ev($0);
  ___cxa_throw($exception, __ZTISt9bad_alloc, 2);
  throw "Reached an unreachable!";
}

function _abort(code) {
  ABORT = true;
  throw "ABORT: " + code + ", at " + (new Error).stack;
}

function _memset(ptr, value, num, align) {
  if (num >= 20) {
    var stop = ptr + num;
    while (ptr % 4) {
      HEAP8[ptr++] = value;
    }
    if (value < 0) value += 256;
    var ptr4 = ptr >> 2, stop4 = stop >> 2, value4 = value | value << 8 | value << 16 | value << 24;
    while (ptr4 < stop4) {
      HEAP32[ptr4++] = value4;
    }
    ptr = ptr4 << 2;
    while (ptr < stop) {
      HEAP8[ptr++] = value;
    }
  } else {
    while (num--) {
      HEAP8[ptr++] = value;
    }
  }
}

var _llvm_memset_p0i8_i32 = _memset;

var ERRNO_CODES = {
  E2BIG: 7,
  EACCES: 13,
  EADDRINUSE: 98,
  EADDRNOTAVAIL: 99,
  EAFNOSUPPORT: 97,
  EAGAIN: 11,
  EALREADY: 114,
  EBADF: 9,
  EBADMSG: 74,
  EBUSY: 16,
  ECANCELED: 125,
  ECHILD: 10,
  ECONNABORTED: 103,
  ECONNREFUSED: 111,
  ECONNRESET: 104,
  EDEADLK: 35,
  EDESTADDRREQ: 89,
  EDOM: 33,
  EDQUOT: 122,
  EEXIST: 17,
  EFAULT: 14,
  EFBIG: 27,
  EHOSTUNREACH: 113,
  EIDRM: 43,
  EILSEQ: 84,
  EINPROGRESS: 115,
  EINTR: 4,
  EINVAL: 22,
  EIO: 5,
  EISCONN: 106,
  EISDIR: 21,
  ELOOP: 40,
  EMFILE: 24,
  EMLINK: 31,
  EMSGSIZE: 90,
  EMULTIHOP: 72,
  ENAMETOOLONG: 36,
  ENETDOWN: 100,
  ENETRESET: 102,
  ENETUNREACH: 101,
  ENFILE: 23,
  ENOBUFS: 105,
  ENODATA: 61,
  ENODEV: 19,
  ENOENT: 2,
  ENOEXEC: 8,
  ENOLCK: 37,
  ENOLINK: 67,
  ENOMEM: 12,
  ENOMSG: 42,
  ENOPROTOOPT: 92,
  ENOSPC: 28,
  ENOSR: 63,
  ENOSTR: 60,
  ENOSYS: 38,
  ENOTCONN: 107,
  ENOTDIR: 20,
  ENOTEMPTY: 39,
  ENOTRECOVERABLE: 131,
  ENOTSOCK: 88,
  ENOTSUP: 95,
  ENOTTY: 25,
  ENXIO: 6,
  EOVERFLOW: 75,
  EOWNERDEAD: 130,
  EPERM: 1,
  EPIPE: 32,
  EPROTO: 71,
  EPROTONOSUPPORT: 93,
  EPROTOTYPE: 91,
  ERANGE: 34,
  EROFS: 30,
  ESPIPE: 29,
  ESRCH: 3,
  ESTALE: 116,
  ETIME: 62,
  ETIMEDOUT: 110,
  ETXTBSY: 26,
  EWOULDBLOCK: 11,
  EXDEV: 18
};

function ___setErrNo(value) {
  if (!___setErrNo.ret) ___setErrNo.ret = allocate([ 0 ], "i32", ALLOC_STATIC);
  HEAP32[___setErrNo.ret >> 2] = value;
  return value;
}

var _stdin = 0;

var _stdout = 0;

var _stderr = 0;

var __impure_ptr = 0;

var FS = {
  currentPath: "/",
  nextInode: 2,
  streams: [ null ],
  ignorePermissions: true,
  absolutePath: (function(relative, base) {
    if (typeof relative !== "string") return null;
    if (base === undefined) base = FS.currentPath;
    if (relative && relative[0] == "/") base = "";
    var full = base + "/" + relative;
    var parts = full.split("/").reverse();
    var absolute = [ "" ];
    while (parts.length) {
      var part = parts.pop();
      if (part == "" || part == ".") {} else if (part == "..") {
        if (absolute.length > 1) absolute.pop();
      } else {
        absolute.push(part);
      }
    }
    return absolute.length == 1 ? "/" : absolute.join("/");
  }),
  analyzePath: (function(path, dontResolveLastLink, linksVisited) {
    var ret = {
      isRoot: false,
      exists: false,
      error: 0,
      name: null,
      path: null,
      object: null,
      parentExists: false,
      parentPath: null,
      parentObject: null
    };
    path = FS.absolutePath(path);
    if (path == "/") {
      ret.isRoot = true;
      ret.exists = ret.parentExists = true;
      ret.name = "/";
      ret.path = ret.parentPath = "/";
      ret.object = ret.parentObject = FS.root;
    } else if (path !== null) {
      linksVisited = linksVisited || 0;
      path = path.slice(1).split("/");
      var current = FS.root;
      var traversed = [ "" ];
      while (path.length) {
        if (path.length == 1 && current.isFolder) {
          ret.parentExists = true;
          ret.parentPath = traversed.length == 1 ? "/" : traversed.join("/");
          ret.parentObject = current;
          ret.name = path[0];
        }
        var target = path.shift();
        if (!current.isFolder) {
          ret.error = ERRNO_CODES.ENOTDIR;
          break;
        } else if (!current.read) {
          ret.error = ERRNO_CODES.EACCES;
          break;
        } else if (!current.contents.hasOwnProperty(target)) {
          ret.error = ERRNO_CODES.ENOENT;
          break;
        }
        current = current.contents[target];
        if (current.link && !(dontResolveLastLink && path.length == 0)) {
          if (linksVisited > 40) {
            ret.error = ERRNO_CODES.ELOOP;
            break;
          }
          var link = FS.absolutePath(current.link, traversed.join("/"));
          return FS.analyzePath([ link ].concat(path).join("/"), dontResolveLastLink, linksVisited + 1);
        }
        traversed.push(target);
        if (path.length == 0) {
          ret.exists = true;
          ret.path = traversed.join("/");
          ret.object = current;
        }
      }
      return ret;
    }
    return ret;
  }),
  findObject: (function(path, dontResolveLastLink) {
    FS.ensureRoot();
    var ret = FS.analyzePath(path, dontResolveLastLink);
    if (ret.exists) {
      return ret.object;
    } else {
      ___setErrNo(ret.error);
      return null;
    }
  }),
  createObject: (function(parent, name, properties, canRead, canWrite) {
    if (!parent) parent = "/";
    if (typeof parent === "string") parent = FS.findObject(parent);
    if (!parent) {
      ___setErrNo(ERRNO_CODES.EACCES);
      throw new Error("Parent path must exist.");
    }
    if (!parent.isFolder) {
      ___setErrNo(ERRNO_CODES.ENOTDIR);
      throw new Error("Parent must be a folder.");
    }
    if (!parent.write && !FS.ignorePermissions) {
      ___setErrNo(ERRNO_CODES.EACCES);
      throw new Error("Parent folder must be writeable.");
    }
    if (!name || name == "." || name == "..") {
      ___setErrNo(ERRNO_CODES.ENOENT);
      throw new Error("Name must not be empty.");
    }
    if (parent.contents.hasOwnProperty(name)) {
      ___setErrNo(ERRNO_CODES.EEXIST);
      throw new Error("Can't overwrite object.");
    }
    parent.contents[name] = {
      read: canRead === undefined ? true : canRead,
      write: canWrite === undefined ? false : canWrite,
      timestamp: Date.now(),
      inodeNumber: FS.nextInode++
    };
    for (var key in properties) {
      if (properties.hasOwnProperty(key)) {
        parent.contents[name][key] = properties[key];
      }
    }
    return parent.contents[name];
  }),
  createFolder: (function(parent, name, canRead, canWrite) {
    var properties = {
      isFolder: true,
      isDevice: false,
      contents: {}
    };
    return FS.createObject(parent, name, properties, canRead, canWrite);
  }),
  createPath: (function(parent, path, canRead, canWrite) {
    var current = FS.findObject(parent);
    if (current === null) throw new Error("Invalid parent.");
    path = path.split("/").reverse();
    while (path.length) {
      var part = path.pop();
      if (!part) continue;
      if (!current.contents.hasOwnProperty(part)) {
        FS.createFolder(current, part, canRead, canWrite);
      }
      current = current.contents[part];
    }
    return current;
  }),
  createFile: (function(parent, name, properties, canRead, canWrite) {
    properties.isFolder = false;
    return FS.createObject(parent, name, properties, canRead, canWrite);
  }),
  createDataFile: (function(parent, name, data, canRead, canWrite) {
    if (typeof data === "string") {
      var dataArray = [];
      for (var i = 0; i < data.length; i++) dataArray.push(data.charCodeAt(i));
      data = dataArray;
    }
    var properties = {
      isDevice: false,
      contents: data
    };
    return FS.createFile(parent, name, properties, canRead, canWrite);
  }),
  createLazyFile: (function(parent, name, url, canRead, canWrite) {
    var properties = {
      isDevice: false,
      url: url
    };
    return FS.createFile(parent, name, properties, canRead, canWrite);
  }),
  createLink: (function(parent, name, target, canRead, canWrite) {
    var properties = {
      isDevice: false,
      link: target
    };
    return FS.createFile(parent, name, properties, canRead, canWrite);
  }),
  createDevice: (function(parent, name, input, output) {
    if (!(input || output)) {
      throw new Error("A device must have at least one callback defined.");
    }
    var ops = {
      isDevice: true,
      input: input,
      output: output
    };
    return FS.createFile(parent, name, ops, Boolean(input), Boolean(output));
  }),
  forceLoadFile: (function(obj) {
    if (obj.isDevice || obj.isFolder || obj.link || obj.contents) return true;
    var success = true;
    if (typeof XMLHttpRequest !== "undefined") {
      var xhr = new XMLHttpRequest;
      xhr.open("GET", obj.url, false);
      if (typeof Uint8Array != "undefined") xhr.responseType = "arraybuffer";
      if (xhr.overrideMimeType) {
        xhr.overrideMimeType("text/plain; charset=x-user-defined");
      }
      xhr.send(null);
      if (xhr.status != 200 && xhr.status != 0) success = false;
      if (xhr.response !== undefined) {
        obj.contents = new Uint8Array(xhr.response || []);
      } else {
        obj.contents = intArrayFromString(xhr.responseText || "", true);
      }
    } else if (typeof read !== "undefined") {
      try {
        obj.contents = intArrayFromString(read(obj.url), true);
      } catch (e) {
        success = false;
      }
    } else {
      throw new Error("Cannot load without read() or XMLHttpRequest.");
    }
    if (!success) ___setErrNo(ERRNO_CODES.EIO);
    return success;
  }),
  ensureRoot: (function() {
    if (FS.root) return;
    FS.root = {
      read: true,
      write: true,
      isFolder: true,
      isDevice: false,
      timestamp: Date.now(),
      inodeNumber: 1,
      contents: {}
    };
  }),
  init: (function(input, output, error) {
    assert(!FS.init.initialized, "FS.init was previously called. If you want to initialize later with custom parameters, remove any earlier calls (note that one is automatically added to the generated code)");
    FS.init.initialized = true;
    FS.ensureRoot();
    if (!input) input = (function() {
      if (!input.cache || !input.cache.length) {
        var result;
        if (typeof window != "undefined" && typeof window.prompt == "function") {
          result = window.prompt("Input: ");
        } else if (typeof readline == "function") {
          result = readline();
        }
        if (!result) result = "";
        input.cache = intArrayFromString(result + "\n", true);
      }
      return input.cache.shift();
    });
    if (!output) output = (function(val) {
      if (val === null || val === "\n".charCodeAt(0)) {
        output.printer(output.buffer.join(""));
        output.buffer = [];
      } else {
        output.buffer.push(String.fromCharCode(val));
      }
    });
    if (!output.printer) output.printer = print;
    if (!output.buffer) output.buffer = [];
    if (!error) error = output;
    FS.createFolder("/", "tmp", true, true);
    var devFolder = FS.createFolder("/", "dev", true, true);
    var stdin = FS.createDevice(devFolder, "stdin", input);
    var stdout = FS.createDevice(devFolder, "stdout", null, output);
    var stderr = FS.createDevice(devFolder, "stderr", null, error);
    FS.createDevice(devFolder, "tty", input, output);
    FS.streams[1] = {
      path: "/dev/stdin",
      object: stdin,
      position: 0,
      isRead: true,
      isWrite: false,
      isAppend: false,
      error: false,
      eof: false,
      ungotten: []
    };
    FS.streams[2] = {
      path: "/dev/stdout",
      object: stdout,
      position: 0,
      isRead: false,
      isWrite: true,
      isAppend: false,
      error: false,
      eof: false,
      ungotten: []
    };
    FS.streams[3] = {
      path: "/dev/stderr",
      object: stderr,
      position: 0,
      isRead: false,
      isWrite: true,
      isAppend: false,
      error: false,
      eof: false,
      ungotten: []
    };
    _stdin = allocate([ 1 ], "void*", ALLOC_STATIC);
    _stdout = allocate([ 2 ], "void*", ALLOC_STATIC);
    _stderr = allocate([ 3 ], "void*", ALLOC_STATIC);
    FS.createPath("/", "dev/shm/tmp", true, true);
    FS.streams[_stdin] = FS.streams[1];
    FS.streams[_stdout] = FS.streams[2];
    FS.streams[_stderr] = FS.streams[3];
    __impure_ptr = allocate([ allocate([ 0, 0, 0, 0, _stdin, 0, 0, 0, _stdout, 0, 0, 0, _stderr, 0, 0, 0 ], "void*", ALLOC_STATIC) ], "void*", ALLOC_STATIC);
  }),
  quit: (function() {
    if (!FS.init.initialized) return;
    if (FS.streams[2].object.output.buffer.length > 0) FS.streams[2].object.output("\n".charCodeAt(0));
    if (FS.streams[3].object.output.buffer.length > 0) FS.streams[3].object.output("\n".charCodeAt(0));
  })
};

function _pwrite(fildes, buf, nbyte, offset) {
  var stream = FS.streams[fildes];
  if (!stream || stream.object.isDevice) {
    ___setErrNo(ERRNO_CODES.EBADF);
    return -1;
  } else if (!stream.isWrite) {
    ___setErrNo(ERRNO_CODES.EACCES);
    return -1;
  } else if (stream.object.isFolder) {
    ___setErrNo(ERRNO_CODES.EISDIR);
    return -1;
  } else if (nbyte < 0 || offset < 0) {
    ___setErrNo(ERRNO_CODES.EINVAL);
    return -1;
  } else {
    var contents = stream.object.contents;
    while (contents.length < offset) contents.push(0);
    for (var i = 0; i < nbyte; i++) {
      contents[offset + i] = HEAPU8[buf + i];
    }
    stream.object.timestamp = Date.now();
    return i;
  }
}

function _write(fildes, buf, nbyte) {
  var stream = FS.streams[fildes];
  if (!stream) {
    ___setErrNo(ERRNO_CODES.EBADF);
    return -1;
  } else if (!stream.isWrite) {
    ___setErrNo(ERRNO_CODES.EACCES);
    return -1;
  } else if (nbyte < 0) {
    ___setErrNo(ERRNO_CODES.EINVAL);
    return -1;
  } else {
    if (stream.object.isDevice) {
      if (stream.object.output) {
        for (var i = 0; i < nbyte; i++) {
          try {
            stream.object.output(HEAP8[buf + i]);
          } catch (e) {
            ___setErrNo(ERRNO_CODES.EIO);
            return -1;
          }
        }
        stream.object.timestamp = Date.now();
        return i;
      } else {
        ___setErrNo(ERRNO_CODES.ENXIO);
        return -1;
      }
    } else {
      var bytesWritten = _pwrite(fildes, buf, nbyte, stream.position);
      if (bytesWritten != -1) stream.position += bytesWritten;
      return bytesWritten;
    }
  }
}

function _fwrite(ptr, size, nitems, stream) {
  var bytesToWrite = nitems * size;
  if (bytesToWrite == 0) return 0;
  var bytesWritten = _write(stream, ptr, bytesToWrite);
  if (bytesWritten == -1) {
    if (FS.streams[stream]) FS.streams[stream].error = true;
    return -1;
  } else {
    return Math.floor(bytesWritten / size);
  }
}

function __formatString(format, varargs) {
  var textIndex = format;
  var argIndex = 0;
  function getNextArg(type) {
    var ret;
    if (type === "double") {
      ret = HEAPF32[varargs + argIndex >> 2];
    } else if (type == "i64") {
      ret = [ HEAP32[varargs + argIndex >> 2], HEAP32[varargs + argIndex + 4 >> 2] ];
    } else {
      type = "i32";
      ret = HEAP32[varargs + argIndex >> 2];
    }
    argIndex += Runtime.getNativeFieldSize(type);
    return ret;
  }
  var ret = [];
  var curr, next, currArg;
  while (1) {
    var startTextIndex = textIndex;
    curr = HEAP8[textIndex];
    if (curr === 0) break;
    next = HEAP8[textIndex + 1];
    if (curr == "%".charCodeAt(0)) {
      var flagAlwaysSigned = false;
      var flagLeftAlign = false;
      var flagAlternative = false;
      var flagZeroPad = false;
      flagsLoop : while (1) {
        switch (next) {
         case "+".charCodeAt(0):
          flagAlwaysSigned = true;
          break;
         case "-".charCodeAt(0):
          flagLeftAlign = true;
          break;
         case "#".charCodeAt(0):
          flagAlternative = true;
          break;
         case "0".charCodeAt(0):
          if (flagZeroPad) {
            break flagsLoop;
          } else {
            flagZeroPad = true;
            break;
          }
         default:
          break flagsLoop;
        }
        textIndex++;
        next = HEAP8[textIndex + 1];
      }
      var width = 0;
      if (next == "*".charCodeAt(0)) {
        width = getNextArg("i32");
        textIndex++;
        next = HEAP8[textIndex + 1];
      } else {
        while (next >= "0".charCodeAt(0) && next <= "9".charCodeAt(0)) {
          width = width * 10 + (next - "0".charCodeAt(0));
          textIndex++;
          next = HEAP8[textIndex + 1];
        }
      }
      var precisionSet = false;
      if (next == ".".charCodeAt(0)) {
        var precision = 0;
        precisionSet = true;
        textIndex++;
        next = HEAP8[textIndex + 1];
        if (next == "*".charCodeAt(0)) {
          precision = getNextArg("i32");
          textIndex++;
        } else {
          while (1) {
            var precisionChr = HEAP8[textIndex + 1];
            if (precisionChr < "0".charCodeAt(0) || precisionChr > "9".charCodeAt(0)) break;
            precision = precision * 10 + (precisionChr - "0".charCodeAt(0));
            textIndex++;
          }
        }
        next = HEAP8[textIndex + 1];
      } else {
        var precision = 6;
      }
      var argSize;
      switch (String.fromCharCode(next)) {
       case "h":
        var nextNext = HEAP8[textIndex + 2];
        if (nextNext == "h".charCodeAt(0)) {
          textIndex++;
          argSize = 1;
        } else {
          argSize = 2;
        }
        break;
       case "l":
        var nextNext = HEAP8[textIndex + 2];
        if (nextNext == "l".charCodeAt(0)) {
          textIndex++;
          argSize = 8;
        } else {
          argSize = 4;
        }
        break;
       case "L":
       case "q":
       case "j":
        argSize = 8;
        break;
       case "z":
       case "t":
       case "I":
        argSize = 4;
        break;
       default:
        argSize = null;
      }
      if (argSize) textIndex++;
      next = HEAP8[textIndex + 1];
      if ([ "d", "i", "u", "o", "x", "X", "p" ].indexOf(String.fromCharCode(next)) != -1) {
        var signed = next == "d".charCodeAt(0) || next == "i".charCodeAt(0);
        argSize = argSize || 4;
        var currArg = getNextArg("i" + argSize * 8);
        if (argSize == 8) {
          currArg = Runtime.makeBigInt(currArg[0], currArg[1], next == "u".charCodeAt(0));
        }
        if (argSize <= 4) {
          var limit = Math.pow(256, argSize) - 1;
          currArg = (signed ? reSign : unSign)(currArg & limit, argSize * 8);
        }
        var currAbsArg = Math.abs(currArg);
        var argText;
        var prefix = "";
        if (next == "d".charCodeAt(0) || next == "i".charCodeAt(0)) {
          argText = reSign(currArg, 8 * argSize, 1).toString(10);
        } else if (next == "u".charCodeAt(0)) {
          argText = unSign(currArg, 8 * argSize, 1).toString(10);
          currArg = Math.abs(currArg);
        } else if (next == "o".charCodeAt(0)) {
          argText = (flagAlternative ? "0" : "") + currAbsArg.toString(8);
        } else if (next == "x".charCodeAt(0) || next == "X".charCodeAt(0)) {
          prefix = flagAlternative ? "0x" : "";
          if (currArg < 0) {
            currArg = -currArg;
            argText = (currAbsArg - 1).toString(16);
            var buffer = [];
            for (var i = 0; i < argText.length; i++) {
              buffer.push((15 - parseInt(argText[i], 16)).toString(16));
            }
            argText = buffer.join("");
            while (argText.length < argSize * 2) argText = "f" + argText;
          } else {
            argText = currAbsArg.toString(16);
          }
          if (next == "X".charCodeAt(0)) {
            prefix = prefix.toUpperCase();
            argText = argText.toUpperCase();
          }
        } else if (next == "p".charCodeAt(0)) {
          if (currAbsArg === 0) {
            argText = "(nil)";
          } else {
            prefix = "0x";
            argText = currAbsArg.toString(16);
          }
        }
        if (precisionSet) {
          while (argText.length < precision) {
            argText = "0" + argText;
          }
        }
        if (flagAlwaysSigned) {
          if (currArg < 0) {
            prefix = "-" + prefix;
          } else {
            prefix = "+" + prefix;
          }
        }
        while (prefix.length + argText.length < width) {
          if (flagLeftAlign) {
            argText += " ";
          } else {
            if (flagZeroPad) {
              argText = "0" + argText;
            } else {
              prefix = " " + prefix;
            }
          }
        }
        argText = prefix + argText;
        argText.split("").forEach((function(chr) {
          ret.push(chr.charCodeAt(0));
        }));
      } else if ([ "f", "F", "e", "E", "g", "G" ].indexOf(String.fromCharCode(next)) != -1) {
        var currArg = getNextArg("double");
        var argText;
        if (isNaN(currArg)) {
          argText = "nan";
          flagZeroPad = false;
        } else if (!isFinite(currArg)) {
          argText = (currArg < 0 ? "-" : "") + "inf";
          flagZeroPad = false;
        } else {
          var isGeneral = false;
          var effectivePrecision = Math.min(precision, 20);
          if (next == "g".charCodeAt(0) || next == "G".charCodeAt(0)) {
            isGeneral = true;
            precision = precision || 1;
            var exponent = parseInt(currArg.toExponential(effectivePrecision).split("e")[1], 10);
            if (precision > exponent && exponent >= -4) {
              next = (next == "g".charCodeAt(0) ? "f" : "F").charCodeAt(0);
              precision -= exponent + 1;
            } else {
              next = (next == "g".charCodeAt(0) ? "e" : "E").charCodeAt(0);
              precision--;
            }
            effectivePrecision = Math.min(precision, 20);
          }
          if (next == "e".charCodeAt(0) || next == "E".charCodeAt(0)) {
            argText = currArg.toExponential(effectivePrecision);
            if (/[eE][-+]\d$/.test(argText)) {
              argText = argText.slice(0, -1) + "0" + argText.slice(-1);
            }
          } else if (next == "f".charCodeAt(0) || next == "F".charCodeAt(0)) {
            argText = currArg.toFixed(effectivePrecision);
          }
          var parts = argText.split("e");
          if (isGeneral && !flagAlternative) {
            while (parts[0].length > 1 && parts[0].indexOf(".") != -1 && (parts[0].slice(-1) == "0" || parts[0].slice(-1) == ".")) {
              parts[0] = parts[0].slice(0, -1);
            }
          } else {
            if (flagAlternative && argText.indexOf(".") == -1) parts[0] += ".";
            while (precision > effectivePrecision++) parts[0] += "0";
          }
          argText = parts[0] + (parts.length > 1 ? "e" + parts[1] : "");
          if (next == "E".charCodeAt(0)) argText = argText.toUpperCase();
          if (flagAlwaysSigned && currArg >= 0) {
            argText = "+" + argText;
          }
        }
        while (argText.length < width) {
          if (flagLeftAlign) {
            argText += " ";
          } else {
            if (flagZeroPad && (argText[0] == "-" || argText[0] == "+")) {
              argText = argText[0] + "0" + argText.slice(1);
            } else {
              argText = (flagZeroPad ? "0" : " ") + argText;
            }
          }
        }
        if (next < "a".charCodeAt(0)) argText = argText.toUpperCase();
        argText.split("").forEach((function(chr) {
          ret.push(chr.charCodeAt(0));
        }));
      } else if (next == "s".charCodeAt(0)) {
        var arg = getNextArg("i8*");
        var copiedString;
        if (arg) {
          copiedString = String_copy(arg);
          if (precisionSet && copiedString.length > precision) {
            copiedString = copiedString.slice(0, precision);
          }
        } else {
          copiedString = intArrayFromString("(null)", true);
        }
        if (!flagLeftAlign) {
          while (copiedString.length < width--) {
            ret.push(" ".charCodeAt(0));
          }
        }
        ret = ret.concat(copiedString);
        if (flagLeftAlign) {
          while (copiedString.length < width--) {
            ret.push(" ".charCodeAt(0));
          }
        }
      } else if (next == "c".charCodeAt(0)) {
        if (flagLeftAlign) ret.push(getNextArg("i8"));
        while (--width > 0) {
          ret.push(" ".charCodeAt(0));
        }
        if (!flagLeftAlign) ret.push(getNextArg("i8"));
      } else if (next == "n".charCodeAt(0)) {
        var ptr = getNextArg("i32*");
        HEAP32[ptr >> 2] = ret.length;
      } else if (next == "%".charCodeAt(0)) {
        ret.push(curr);
      } else {
        for (var i = startTextIndex; i < textIndex + 2; i++) {
          ret.push(HEAP8[i]);
        }
      }
      textIndex += 2;
    } else {
      ret.push(curr);
      textIndex += 1;
    }
  }
  return ret;
}

function _fprintf(stream, format, varargs) {
  var result = __formatString(format, varargs);
  var stack = Runtime.stackSave();
  var ret = _fwrite(allocate(result, "i8", ALLOC_STACK), 1, result.length, stream);
  Runtime.stackRestore(stack);
  return ret;
}

function _memcpy(dest, src, num, align) {
  if (num >= 20 && src % 2 == dest % 2) {
    if (src % 4 == dest % 4) {
      var stop = src + num;
      while (src % 4) {
        HEAP8[dest++] = HEAP8[src++];
      }
      var src4 = src >> 2, dest4 = dest >> 2, stop4 = stop >> 2;
      while (src4 < stop4) {
        HEAP32[dest4++] = HEAP32[src4++];
      }
      src = src4 << 2;
      dest = dest4 << 2;
      while (src < stop) {
        HEAP8[dest++] = HEAP8[src++];
      }
    } else {
      var stop = src + num;
      if (src % 2) {
        HEAP8[dest++] = HEAP8[src++];
      }
      var src2 = src >> 1, dest2 = dest >> 1, stop2 = stop >> 1;
      while (src2 < stop2) {
        HEAP16[dest2++] = HEAP16[src2++];
      }
      src = src2 << 1;
      dest = dest2 << 1;
      if (src < stop) {
        HEAP8[dest++] = HEAP8[src++];
      }
    }
  } else {
    while (num--) {
      HEAP8[dest++] = HEAP8[src++];
    }
  }
}

var _llvm_memcpy_p0i8_p0i8_i32 = _memcpy;

function _sysconf(name) {
  switch (name) {
   case 8:
    return PAGE_SIZE;
   case 54:
   case 56:
   case 21:
   case 61:
   case 63:
   case 22:
   case 67:
   case 23:
   case 24:
   case 25:
   case 26:
   case 27:
   case 69:
   case 28:
   case 101:
   case 70:
   case 71:
   case 29:
   case 30:
   case 199:
   case 75:
   case 76:
   case 32:
   case 43:
   case 44:
   case 80:
   case 46:
   case 47:
   case 45:
   case 48:
   case 49:
   case 42:
   case 82:
   case 33:
   case 7:
   case 108:
   case 109:
   case 107:
   case 112:
   case 119:
   case 121:
    return 200809;
   case 13:
   case 104:
   case 94:
   case 95:
   case 34:
   case 35:
   case 77:
   case 81:
   case 83:
   case 84:
   case 85:
   case 86:
   case 87:
   case 88:
   case 89:
   case 90:
   case 91:
   case 94:
   case 95:
   case 110:
   case 111:
   case 113:
   case 114:
   case 115:
   case 116:
   case 117:
   case 118:
   case 120:
   case 40:
   case 16:
   case 79:
   case 19:
    return -1;
   case 92:
   case 93:
   case 5:
   case 72:
   case 6:
   case 74:
   case 92:
   case 93:
   case 96:
   case 97:
   case 98:
   case 99:
   case 102:
   case 103:
   case 105:
    return 1;
   case 38:
   case 66:
   case 50:
   case 51:
   case 4:
    return 1024;
   case 15:
   case 64:
   case 41:
    return 32;
   case 55:
   case 37:
   case 17:
    return 2147483647;
   case 18:
   case 1:
    return 47839;
   case 59:
   case 57:
    return 99;
   case 68:
   case 58:
    return 2048;
   case 0:
    return 2097152;
   case 3:
    return 65536;
   case 14:
    return 32768;
   case 73:
    return 32767;
   case 39:
    return 16384;
   case 60:
    return 1e3;
   case 106:
    return 700;
   case 52:
    return 256;
   case 62:
    return 255;
   case 2:
    return 100;
   case 65:
    return 64;
   case 36:
    return 20;
   case 100:
    return 16;
   case 20:
    return 6;
   case 53:
    return 4;
  }
  ___setErrNo(ERRNO_CODES.EINVAL);
  return -1;
}

function _time(ptr) {
  var ret = Math.floor(Date.now() / 1e3);
  if (ptr) {
    HEAP32[ptr >> 2] = ret;
  }
  return ret;
}

function ___errno_location() {
  return ___setErrNo.ret;
}

var ___errno = ___errno_location;

function _sbrk(bytes) {
  var self = _sbrk;
  if (!self.called) {
    STATICTOP = alignMemoryPage(STATICTOP);
    self.called = true;
  }
  var ret = STATICTOP;
  if (bytes != 0) Runtime.staticAlloc(bytes);
  return ret;
}

function ___gxx_personality_v0() {}

function ___cxa_allocate_exception(size) {
  return _malloc(size);
}

function _llvm_eh_exception() {
  return HEAP32[_llvm_eh_exception.buf >> 2];
}

function __ZSt18uncaught_exceptionv() {
  return !!__ZSt18uncaught_exceptionv.uncaught_exception;
}

function ___cxa_is_number_type(type) {
  var isNumber = false;
  try {
    if (type == __ZTIi) isNumber = true;
  } catch (e) {}
  try {
    if (type == __ZTIl) isNumber = true;
  } catch (e) {}
  try {
    if (type == __ZTIx) isNumber = true;
  } catch (e) {}
  try {
    if (type == __ZTIf) isNumber = true;
  } catch (e) {}
  try {
    if (type == __ZTId) isNumber = true;
  } catch (e) {}
  return isNumber;
}

function ___cxa_does_inherit(definiteType, possibilityType, possibility) {
  if (possibility == 0) return false;
  if (possibilityType == 0 || possibilityType == definiteType) return true;
  var possibility_type_info;
  if (___cxa_is_number_type(possibilityType)) {
    possibility_type_info = possibilityType;
  } else {
    var possibility_type_infoAddr = HEAP32[possibilityType >> 2] - 8;
    possibility_type_info = HEAP32[possibility_type_infoAddr >> 2];
  }
  switch (possibility_type_info) {
   case 0:
    var definite_type_infoAddr = HEAP32[definiteType >> 2] - 8;
    var definite_type_info = HEAP32[definite_type_infoAddr >> 2];
    if (definite_type_info == 0) {
      var defPointerBaseAddr = definiteType + 8;
      var defPointerBaseType = HEAP32[defPointerBaseAddr >> 2];
      var possPointerBaseAddr = possibilityType + 8;
      var possPointerBaseType = HEAP32[possPointerBaseAddr >> 2];
      return ___cxa_does_inherit(defPointerBaseType, possPointerBaseType, possibility);
    } else return false;
   case 1:
    return false;
   case 2:
    var parentTypeAddr = possibilityType + 8;
    var parentType = HEAP32[parentTypeAddr >> 2];
    return ___cxa_does_inherit(definiteType, parentType, possibility);
   default:
    return false;
  }
}

function ___cxa_find_matching_catch(thrown, throwntype, typeArray) {
  if (throwntype != 0 && !___cxa_is_number_type(throwntype)) {
    var throwntypeInfoAddr = HEAP32[throwntype >> 2] - 8;
    var throwntypeInfo = HEAP32[throwntypeInfoAddr >> 2];
    if (throwntypeInfo == 0) thrown = HEAP32[thrown >> 2];
  }
  for (var i = 0; i < typeArray.length; i++) {
    if (___cxa_does_inherit(typeArray[i], throwntype, thrown)) return {
      "f0": thrown,
      "f1": typeArray[i]
    };
  }
  return {
    "f0": thrown,
    "f1": throwntype
  };
}

function ___cxa_throw(ptr, type, destructor) {
  if (!___cxa_throw.initialized) {
    try {
      HEAP32[__ZTVN10__cxxabiv119__pointer_type_infoE >> 2] = 0;
    } catch (e) {}
    try {
      HEAP32[__ZTVN10__cxxabiv117__class_type_infoE >> 2] = 1;
    } catch (e) {}
    try {
      HEAP32[__ZTVN10__cxxabiv120__si_class_type_infoE >> 2] = 2;
    } catch (e) {}
    ___cxa_throw.initialized = true;
  }
  print("Compiled code throwing an exception, " + [ ptr, type, destructor ] + ", at " + (new Error).stack);
  HEAP32[_llvm_eh_exception.buf >> 2] = ptr;
  HEAP32[_llvm_eh_exception.buf + 4 >> 2] = type;
  HEAP32[_llvm_eh_exception.buf + 8 >> 2] = destructor;
  if (!("uncaught_exception" in __ZSt18uncaught_exceptionv)) {
    __ZSt18uncaught_exceptionv.uncaught_exception = 1;
  } else {
    __ZSt18uncaught_exceptionv.uncaught_exception++;
  }
  throw ptr;
}

function ___cxa_call_unexpected(exception) {
  ABORT = true;
  throw exception;
}

function ___cxa_begin_catch(ptr) {
  __ZSt18uncaught_exceptionv.uncaught_exception--;
  return ptr;
}

function ___cxa_free_exception(ptr) {
  return _free(ptr);
}

function ___cxa_end_catch() {
  if (___cxa_end_catch.rethrown) {
    ___cxa_end_catch.rethrown = false;
    return;
  }
  __THREW__ = false;
  HEAP32[_llvm_eh_exception.buf + 4 >> 2] = 0;
  var ptr = HEAP32[_llvm_eh_exception.buf >> 2];
  var destructor = HEAP32[_llvm_eh_exception.buf + 8 >> 2];
  if (destructor) {
    FUNCTION_TABLE[destructor](ptr);
    HEAP32[_llvm_eh_exception.buf + 8 >> 2] = 0;
  }
  if (ptr) {
    ___cxa_free_exception(ptr);
    HEAP32[_llvm_eh_exception.buf >> 2] = 0;
  }
}

var __ZNSt9exceptionD2Ev;

__ATINIT__.unshift({
  func: (function() {
    FS.ignorePermissions = false;
    if (!FS.init.initialized) FS.init();
  })
});

__ATEXIT__.push({
  func: (function() {
    FS.quit();
  })
});

___setErrNo(0);

_llvm_eh_exception.buf = allocate(12, "void*", ALLOC_STATIC);

Module.callMain = function callMain(args) {
  var argc = args.length + 1;
  function pad() {
    for (var i = 0; i < 4 - 1; i++) {
      argv.push(0);
    }
  }
  var argv = [ allocate(intArrayFromString("/bin/this.program"), "i8", ALLOC_STATIC) ];
  pad();
  for (var i = 0; i < argc - 1; i = i + 1) {
    argv.push(allocate(intArrayFromString(args[i]), "i8", ALLOC_STATIC));
    pad();
  }
  argv.push(0);
  argv = allocate(argv, "i32", ALLOC_STATIC);
  return _main(argc, argv, 0);
};

var __gm_;

var _mparams;

var __impure_ptr;

var __ZSt7nothrow;

var __ZL13__new_handler;

var __ZTVSt9bad_alloc;

var __ZTVSt20bad_array_new_length;

var __ZTVN10__cxxabiv120__si_class_type_infoE;

var __ZTISt9exception;

var __ZTISt9bad_alloc;

var __ZTISt20bad_array_new_length;

var __ZNSt9bad_allocC1Ev;

var __ZNSt9bad_allocD1Ev;

var __ZNSt20bad_array_new_lengthC1Ev;

var __ZNSt20bad_array_new_lengthD1Ev;

var __ZNSt20bad_array_new_lengthD2Ev;

__gm_ = allocate(468, [ "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "*", 0, 0, 0, "i32", 0, 0, 0, "*", 0, 0, 0, "i32", 0, 0, 0, "*", 0, 0, 0, "i32", 0, 0, 0 ], ALLOC_STATIC);

_mparams = allocate(24, "i32", ALLOC_STATIC);

STRING_TABLE.__str = allocate([ 109, 97, 120, 32, 115, 121, 115, 116, 101, 109, 32, 98, 121, 116, 101, 115, 32, 61, 32, 37, 49, 48, 108, 117, 10, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str1 = allocate([ 115, 121, 115, 116, 101, 109, 32, 98, 121, 116, 101, 115, 32, 32, 32, 32, 32, 61, 32, 37, 49, 48, 108, 117, 10, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str2 = allocate([ 105, 110, 32, 117, 115, 101, 32, 98, 121, 116, 101, 115, 32, 32, 32, 32, 32, 61, 32, 37, 49, 48, 108, 117, 10, 0 ], "i8", ALLOC_STATIC);

__ZSt7nothrow = allocate([ undef ], "i8", ALLOC_STATIC);

__ZL13__new_handler = allocate(1, "void ()*", ALLOC_STATIC);

__ZTVSt9bad_alloc = allocate([ 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 4, 0, 0, 0, 6, 0, 0, 0 ], [ "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0 ], ALLOC_STATIC);

allocate(1, "void*", ALLOC_STATIC);

STRING_TABLE.__str3 = allocate([ 115, 116, 100, 58, 58, 98, 97, 100, 95, 97, 108, 108, 111, 99, 0 ], "i8", ALLOC_STATIC);

__ZTVSt20bad_array_new_length = allocate([ 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 8, 0, 0, 0, 10, 0, 0, 0 ], [ "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0 ], ALLOC_STATIC);

allocate(1, "void*", ALLOC_STATIC);

STRING_TABLE.__str14 = allocate([ 98, 97, 100, 95, 97, 114, 114, 97, 121, 95, 110, 101, 119, 95, 108, 101, 110, 103, 116, 104, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__ZTSSt9bad_alloc = allocate([ 83, 116, 57, 98, 97, 100, 95, 97, 108, 108, 111, 99, 0 ], "i8", ALLOC_STATIC);

__ZTISt9bad_alloc = allocate(12, "*", ALLOC_STATIC);

STRING_TABLE.__ZTSSt20bad_array_new_length = allocate([ 83, 116, 50, 48, 98, 97, 100, 95, 97, 114, 114, 97, 121, 95, 110, 101, 119, 95, 108, 101, 110, 103, 116, 104, 0 ], "i8", ALLOC_STATIC);

__ZTISt20bad_array_new_length = allocate(12, "*", ALLOC_STATIC);

HEAP32[__ZTVSt9bad_alloc + 4 >> 2] = __ZTISt9bad_alloc;

HEAP32[__ZTVSt20bad_array_new_length + 4 >> 2] = __ZTISt20bad_array_new_length;

__ZTVN10__cxxabiv120__si_class_type_infoE = allocate([ 2, 0, 0, 0, 0 ], [ "i8*", 0, 0, 0, 0 ], ALLOC_STATIC);

HEAP32[__ZTISt9bad_alloc >> 2] = __ZTVN10__cxxabiv120__si_class_type_infoE + 8;

HEAP32[__ZTISt9bad_alloc + 4 >> 2] = STRING_TABLE.__ZTSSt9bad_alloc;

HEAP32[__ZTISt9bad_alloc + 8 >> 2] = __ZTISt9exception;

HEAP32[__ZTISt20bad_array_new_length >> 2] = __ZTVN10__cxxabiv120__si_class_type_infoE + 8;

HEAP32[__ZTISt20bad_array_new_length + 4 >> 2] = STRING_TABLE.__ZTSSt20bad_array_new_length;

HEAP32[__ZTISt20bad_array_new_length + 8 >> 2] = __ZTISt9bad_alloc;

__ZNSt9bad_allocC1Ev = 12;

__ZNSt9bad_allocD1Ev = 2;

__ZNSt20bad_array_new_lengthC1Ev = 14;

__ZNSt20bad_array_new_lengthD1Ev = 2;

__ZNSt20bad_array_new_lengthD2Ev = 2;

FUNCTION_TABLE = [ 0, 0, __ZNSt9bad_allocD2Ev, 0, __ZNSt9bad_allocD0Ev, 0, __ZNKSt9bad_alloc4whatEv, 0, __ZNSt20bad_array_new_lengthD0Ev, 0, __ZNKSt20bad_array_new_length4whatEv, 0, __ZNSt9bad_allocC2Ev, 0, __ZNSt20bad_array_new_lengthC2Ev, 0 ];

Module["FUNCTION_TABLE"] = FUNCTION_TABLE;

function run(args) {
  args = args || Module["arguments"];
  initRuntime();
  var ret = null;
  if (Module["_main"]) {
    ret = Module.callMain(args);
    exitRuntime();
  }
  return ret;
}

Module["run"] = run;

if (Module["preRun"]) {
  Module["preRun"]();
}

if (!Module["noInitialRun"]) {
  var ret = run();
}

if (Module["postRun"]) {
  Module["postRun"]();
}
// EMSCRIPTEN_GENERATED_FUNCTIONS: ["_malloc","_tmalloc_small","_sys_alloc","_tmalloc_large","_sys_trim","_free","_malloc_footprint","_malloc_max_footprint","_release_unused_segments","_calloc","_realloc","_memalign","_internal_memalign","_independent_calloc","_ialloc","_independent_comalloc","_valloc","_pvalloc","_malloc_trim","_mallinfo","_internal_mallinfo","_malloc_stats","_internal_malloc_stats","_mallopt","_internal_realloc","_init_mparams","_malloc_usable_size","_mmap_resize","_segment_holding","_init_top","_init_bins","_change_mparam","_prepend_alloc","__ZNKSt9bad_alloc4whatEv","__ZNKSt20bad_array_new_length4whatEv","__ZSt15get_new_handlerv","__ZSt15set_new_handlerPFvvE","__ZNSt9bad_allocC2Ev","__ZdlPv","__ZdlPvRKSt9nothrow_t","__ZdaPv","__ZdaPvRKSt9nothrow_t","__ZNSt9bad_allocD0Ev","__ZNSt9bad_allocD2Ev","__ZNSt20bad_array_new_lengthC2Ev","__ZNSt20bad_array_new_lengthD0Ev","_add_segment","__Znwj","__ZnwjRKSt9nothrow_t","__Znaj","__ZnajRKSt9nothrow_t","__ZSt17__throw_bad_allocv"]

