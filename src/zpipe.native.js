var arguments_ = [];

var ENVIRONMENT_IS_NODE = typeof process === "object";

var ENVIRONMENT_IS_WEB = typeof window === "object";

var ENVIRONMENT_IS_WORKER = typeof importScripts === "function";

var ENVIRONMENT_IS_SHELL = !ENVIRONMENT_IS_WEB && !ENVIRONMENT_IS_NODE && !ENVIRONMENT_IS_WORKER;

if (ENVIRONMENT_IS_NODE) {
  var print = (function(x) {
    process["stdout"].write(x + "\n");
  });
  var printErr = (function(x) {
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
} else if (ENVIRONMENT_IS_WEB) {
  var print = printErr = (function(x) {
    console.log(x);
  });
  var read = (function(url) {
    var xhr = new XMLHttpRequest;
    xhr.open("GET", url, false);
    xhr.send(null);
    return xhr.responseText;
  });
} else if (ENVIRONMENT_IS_WORKER) {
  var load = importScripts;
} else {
  throw "Unknown runtime environment. Where are we?";
}

function globalEval(x) {
  eval.call(null, x);
}

if (typeof load == "undefined" && typeof read != "undefined") {
  var load = (function(f) {
    globalEval(read(f));
  });
}

if (typeof printErr === "undefined") {
  var printErr = (function() {});
}

if (typeof print === "undefined") {
  var print = printErr;
}

var Module = {};

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
    return type.substr(type.length - 1, 1) == "*";
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
      if (type.substr(type.length - 1, 1) == "*") {
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
    return ret;
  },
  staticAlloc: function staticAlloc(size) {
    var ret = STATICTOP;
    STATICTOP += size;
    STATICTOP = STATICTOP + 3 >> 2 << 2;
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
  if (type.substr(type.length - 1, 1) === "*") type = "i32";
  switch (type) {
   case "i1":
    HEAP[ptr] = value;
    break;
   case "i8":
    HEAP[ptr] = value;
    break;
   case "i16":
    HEAP[ptr] = value;
    break;
   case "i32":
    HEAP[ptr] = value;
    break;
   case "i64":
    HEAP[ptr] = value;
    break;
   case "float":
    HEAP[ptr] = value;
    break;
   case "double":
    HEAP[ptr] = value;
    break;
   default:
    abort("invalid type for setValue: " + type);
  }
}

Module["setValue"] = setValue;

function getValue(ptr, type, noSafe) {
  type = type || "i8";
  if (type.substr(type.length - 1, 1) === "*") type = "i32";
  switch (type) {
   case "i1":
    return HEAP[ptr];
   case "i8":
    return HEAP[ptr];
   case "i16":
    return HEAP[ptr];
   case "i32":
    return HEAP[ptr];
   case "i64":
    return HEAP[ptr];
   case "float":
    return HEAP[ptr];
   case "double":
    return HEAP[ptr];
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
    t = String.fromCharCode(HEAP[ptr + i]);
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

var STACK_ROOT, STACKTOP, STACK_MAX;

var STATICTOP;

var TOTAL_STACK = Module["TOTAL_STACK"] || 5242880;

var TOTAL_MEMORY = Module["TOTAL_MEMORY"] || 10485760;

var FAST_MEMORY = Module["FAST_MEMORY"] || 2097152;

HEAP = [];

for (var i = 0; i < FAST_MEMORY; i++) {
  HEAP[i] = 0;
}

var base = intArrayFromString("(null)");

STATICTOP = base.length;

for (var i = 0; i < base.length; i++) {
  HEAP[i] = base[i];
}

Module["HEAP"] = HEAP;

STACK_ROOT = STACKTOP = Runtime.alignMemory(STATICTOP);

STACK_MAX = STACK_ROOT + TOTAL_STACK;

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
  return HEAP.slice(ptr, ptr + num);
}

Module["Array_copy"] = Array_copy;

function String_len(ptr) {
  var i = 0;
  while (HEAP[ptr + i]) i++;
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
    HEAP[buffer + i] = chr;
    i = i + 1;
  }
  if (!dontAddNull) {
    HEAP[buffer + i] = 0;
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

function _def($source, $dest) {
  var __stackBase__ = STACKTOP;
  STACKTOP += 32824;
  var $retval;
  var $source_addr;
  var $dest_addr;
  var $level_addr;
  var $ret;
  var $flush;
  var $have;
  var $strm = __stackBase__;
  var $in = __stackBase__ + 56;
  var $out = __stackBase__ + 16440;
  $source_addr = $source;
  $dest_addr = $dest;
  $level_addr = -1;
  HEAP[$strm + 32 | 0] = 0;
  HEAP[$strm + 36 | 0] = 0;
  HEAP[$strm + 40 | 0] = 0;
  var $call = _deflateInit2_($strm, $level_addr, 8, 15, 8, 0, STRING_TABLE.__str | 0, 56);
  $ret = $call;
  var $cmp = ($ret | 0) != 0;
  $if_then$$do_body_preheader$2 : do {
    if ($cmp) {
      $retval = $ret;
    } else {
      var $arraydecay = $in | 0;
      var $avail_in = $strm + 4 | 0;
      var $arraydecay8 = $in | 0;
      var $next_in = $strm | 0;
      var $avail_out = $strm + 16 | 0;
      var $arraydecay10 = $out | 0;
      var $next_out = $strm + 12 | 0;
      var $avail_out13 = $strm + 16 | 0;
      var $arraydecay14 = $out | 0;
      var $avail_out22 = $strm + 16 | 0;
      var $avail_in24 = $strm + 4 | 0;
      $do_body$5 : while (1) {
        var $call1 = _fread($arraydecay, 1, 16384, $source_addr);
        HEAP[$avail_in] = $call1;
        var $call2 = _ferror($source_addr);
        if (($call2 | 0) != 0) {
          var $call4 = _deflateEnd($strm);
          $retval = -1;
          break $if_then$$do_body_preheader$2;
        }
        var $call6 = _feof($source_addr);
        var $cond = ($call6 | 0) != 0 ? 4 : 1;
        $flush = $cond;
        HEAP[$next_in] = $arraydecay8;
        $do_body9$10 : while (1) {
          HEAP[$avail_out] = 16384;
          HEAP[$next_out] = $arraydecay10;
          var $call11 = _deflate($strm, $flush);
          $ret = $call11;
          if (($call11 | 0) == -2) {
            ___assert_func(STRING_TABLE.__str1 | 0, 75, STRING_TABLE.___func___def | 0, STRING_TABLE.__str2 | 0);
          }
          $have = 16384 - HEAP[$avail_out13] | 0;
          var $call15 = _fwrite($arraydecay14, 1, $have, $dest_addr);
          var $cmp16 = ($call15 | 0) != ($have | 0);
          do {
            if (!$cmp16) {
              var $call17 = _ferror($dest_addr);
              if (($call17 | 0) != 0) {
                break;
              }
              if ((HEAP[$avail_out22] | 0) == 0) {
                continue $do_body9$10;
              }
              if ((HEAP[$avail_in24] | 0) != 0) {
                ___assert_func(STRING_TABLE.__str1 | 0, 82, STRING_TABLE.___func___def | 0, STRING_TABLE.__str3 | 0);
              }
              if (($flush | 0) != 4) {
                continue $do_body$5;
              }
              if (($ret | 0) != 1) {
                ___assert_func(STRING_TABLE.__str1 | 0, 86, STRING_TABLE.___func___def | 0, STRING_TABLE.__str4 | 0);
              }
              var $call36 = _deflateEnd($strm);
              $retval = 0;
              break $if_then$$do_body_preheader$2;
            }
          } while (0);
          var $call20 = _deflateEnd($strm);
          $retval = -1;
          break $if_then$$do_body_preheader$2;
        }
      }
    }
  } while (0);
  STACKTOP = __stackBase__;
  return $retval;
  return null;
}

_def["X"] = 1;

function _inf($source, $dest) {
  var __stackBase__ = STACKTOP;
  STACKTOP += 32824;
  var $retval;
  var $source_addr;
  var $dest_addr;
  var $ret;
  var $have;
  var $strm = __stackBase__;
  var $in = __stackBase__ + 56;
  var $out = __stackBase__ + 16440;
  $source_addr = $source;
  $dest_addr = $dest;
  HEAP[$strm + 32 | 0] = 0;
  HEAP[$strm + 36 | 0] = 0;
  HEAP[$strm + 40 | 0] = 0;
  HEAP[$strm + 4 | 0] = 0;
  HEAP[$strm | 0] = 0;
  var $call = _inflateInit_($strm);
  $ret = $call;
  var $cmp = ($ret | 0) != 0;
  $if_then$$do_body_preheader$29 : do {
    if ($cmp) {
      $retval = $ret;
    } else {
      var $arraydecay = $in | 0;
      var $avail_in2 = $strm + 4 | 0;
      var $avail_in7 = $strm + 4 | 0;
      var $arraydecay11 = $in | 0;
      var $next_in12 = $strm | 0;
      var $avail_out = $strm + 16 | 0;
      var $arraydecay14 = $out | 0;
      var $next_out = $strm + 12 | 0;
      var $avail_out19 = $strm + 16 | 0;
      var $arraydecay20 = $out | 0;
      var $avail_out28 = $strm + 16 | 0;
      $do_body$32 : while (1) {
        var $call1 = _fread($arraydecay, 1, 16384, $source_addr);
        HEAP[$avail_in2] = $call1;
        var $call3 = _ferror($source_addr);
        if (($call3 | 0) != 0) {
          _inflateEnd($strm);
          $retval = -1;
          break $if_then$$do_body_preheader$29;
        }
        var $cmp8 = (HEAP[$avail_in7] | 0) == 0;
        $do_end32$$if_end10$37 : do {
          if (!$cmp8) {
            HEAP[$next_in12] = $arraydecay11;
            $do_body13$39 : while (1) {
              HEAP[$avail_out] = 16384;
              HEAP[$next_out] = $arraydecay14;
              var $call15 = _inflate($strm);
              $ret = $call15;
              if (($call15 | 0) != -2) {
                var $5 = $call15;
              } else {
                ___assert_func(STRING_TABLE.__str1 | 0, 133, STRING_TABLE.___func___inf | 0, STRING_TABLE.__str2 | 0);
                var $5 = $ret;
              }
              var $5;
              if ($5 == 2) {
                $ret = -3;
                break $do_body$32;
              } else if ($5 == -3 || $5 == -4) {
                break $do_body$32;
              } else {
                $have = 16384 - HEAP[$avail_out19] | 0;
                var $call21 = _fwrite($arraydecay20, 1, $have, $dest_addr);
                var $cmp22 = ($call21 | 0) != ($have | 0);
                do {
                  if (!$cmp22) {
                    var $call23 = _ferror($dest_addr);
                    if (($call23 | 0) != 0) {
                      break;
                    }
                    if ((HEAP[$avail_out28] | 0) == 0) {
                      continue $do_body13$39;
                    }
                    if (($ret | 0) != 1) {
                      continue $do_body$32;
                    }
                    break $do_end32$$if_end10$37;
                  }
                } while (0);
                _inflateEnd($strm);
                $retval = -1;
                break $if_then$$do_body_preheader$29;
              }
            }
          }
        } while (0);
        _inflateEnd($strm);
        var $cond = ($ret | 0) == 1 ? 0 : -3;
        $retval = $cond;
        break $if_then$$do_body_preheader$29;
      }
      _inflateEnd($strm);
      $retval = $ret;
    }
  } while (0);
  STACKTOP = __stackBase__;
  return $retval;
  return null;
}

_inf["X"] = 1;

function _zerr($ret) {
  var $ret_addr;
  $ret_addr = $ret;
  var $1 = HEAP[HEAP[__impure_ptr] + 12 | 0];
  var $2 = _fwrite(STRING_TABLE.__str5 | 0, 7, 1, $1);
  var $3 = $ret_addr;
  do {
    if ($3 == -1) {
      var $5 = HEAP[HEAP[__impure_ptr] + 4 | 0];
      var $call1 = _ferror($5);
      if (($call1 | 0) != 0) {
        var $7 = HEAP[HEAP[__impure_ptr] + 12 | 0];
        var $8 = _fwrite(STRING_TABLE.__str6 | 0, 20, 1, $7);
      }
      var $10 = HEAP[HEAP[__impure_ptr] + 8 | 0];
      var $call4 = _ferror($10);
      if (($call4 | 0) == 0) {
        break;
      }
      var $12 = HEAP[HEAP[__impure_ptr] + 12 | 0];
      var $13 = _fwrite(STRING_TABLE.__str7 | 0, 21, 1, $12);
    } else if ($3 == -2) {
      var $15 = HEAP[HEAP[__impure_ptr] + 12 | 0];
      var $16 = _fwrite(STRING_TABLE.__str8 | 0, 26, 1, $15);
    } else if ($3 == -3) {
      var $18 = HEAP[HEAP[__impure_ptr] + 12 | 0];
      var $19 = _fwrite(STRING_TABLE.__str9 | 0, 35, 1, $18);
    } else if ($3 == -4) {
      var $21 = HEAP[HEAP[__impure_ptr] + 12 | 0];
      var $22 = _fwrite(STRING_TABLE.__str10 | 0, 14, 1, $21);
    } else if ($3 == -6) {
      var $24 = HEAP[HEAP[__impure_ptr] + 12 | 0];
      var $25 = _fwrite(STRING_TABLE.__str11 | 0, 23, 1, $24);
    }
  } while (0);
  return;
  return;
}

_zerr["X"] = 1;

function _main($argc, $argv) {
  var $retval;
  var $argc_addr;
  var $argv_addr;
  var $ret;
  $retval = 0;
  $argc_addr = $argc;
  $argv_addr = $argv;
  var $cmp = ($argc_addr | 0) == 1;
  $if_then$$if_else$68 : do {
    if ($cmp) {
      var $2 = HEAP[HEAP[__impure_ptr] + 4 | 0];
      var $4 = HEAP[HEAP[__impure_ptr] + 8 | 0];
      var $call = _def($2, $4);
      $ret = $call;
      if (($ret | 0) != 0) {
        _zerr($ret);
      }
      $retval = $ret;
    } else {
      var $cmp3 = ($argc_addr | 0) == 2;
      do {
        if ($cmp3) {
          var $10 = HEAP[$argv_addr + 4 | 0];
          var $call4 = _strcmp($10, STRING_TABLE.__str12 | 0);
          if (($call4 | 0) != 0) {
            break;
          }
          var $12 = HEAP[HEAP[__impure_ptr] + 4 | 0];
          var $14 = HEAP[HEAP[__impure_ptr] + 8 | 0];
          var $call9 = _inf($12, $14);
          $ret = $call9;
          if (($ret | 0) != 0) {
            _zerr($ret);
          }
          $retval = $ret;
          break $if_then$$if_else$68;
        }
      } while (0);
      var $19 = HEAP[HEAP[__impure_ptr] + 12 | 0];
      var $20 = _fwrite(STRING_TABLE.__str13 | 0, 40, 1, $19);
      $retval = 1;
    }
  } while (0);
  return $retval;
  return null;
}

Module["_main"] = _main;

_main["X"] = 1;

function _deflateInit2_($strm, $level, $method, $windowBits, $memLevel, $strategy, $version, $stream_size) {
  var __label__;
  var $retval;
  var $strm_addr;
  var $level_addr;
  var $method_addr;
  var $windowBits_addr;
  var $memLevel_addr;
  var $strategy_addr;
  var $version_addr;
  var $stream_size_addr;
  var $s;
  var $wrap;
  var $overlay;
  $strm_addr = $strm;
  $level_addr = $level;
  $method_addr = $method;
  $windowBits_addr = $windowBits;
  $memLevel_addr = $memLevel;
  $strategy_addr = $strategy;
  $version_addr = $version;
  $stream_size_addr = $stream_size;
  $wrap = 1;
  var $cmp = ($version_addr | 0) == 0;
  $if_then$$lor_lhs_false$83 : do {
    if ($cmp) {
      __label__ = 3;
    } else {
      if ((HEAP[$version_addr | 0] << 24 >> 24 | 0) != 49) {
        __label__ = 3;
        break;
      }
      if (($stream_size_addr | 0) != 56) {
        __label__ = 3;
        break;
      }
      if (($strm_addr | 0) == 0) {
        $retval = -2;
        __label__ = 32;
        break;
      }
      HEAP[$strm_addr + 24 | 0] = 0;
      if ((HEAP[$strm_addr + 32 | 0] | 0) == 0) {
        HEAP[$strm_addr + 32 | 0] = 2;
        HEAP[$strm_addr + 40 | 0] = 0;
      }
      if ((HEAP[$strm_addr + 36 | 0] | 0) == 0) {
        HEAP[$strm_addr + 36 | 0] = 4;
      }
      if (($level_addr | 0) == -1) {
        $level_addr = 6;
      }
      var $cmp25 = ($windowBits_addr | 0) < 0;
      do {
        if ($cmp25) {
          $wrap = 0;
          var $sub = -$windowBits_addr | 0;
          $windowBits_addr = $sub;
        } else {
          if (($windowBits_addr | 0) <= 15) {
            break;
          }
          $wrap = 2;
          var $sub31 = $windowBits_addr - 16 | 0;
          $windowBits_addr = $sub31;
        }
      } while (0);
      var $or_cond = ($memLevel_addr | 0) < 1 | ($memLevel_addr | 0) > 9;
      do {
        if (!$or_cond) {
          if (($method_addr | 0) != 8) {
            break;
          }
          if (($windowBits_addr | 0) < 8 | ($windowBits_addr | 0) > 15) {
            break;
          }
          if (($level_addr | 0) < 0 | ($level_addr | 0) > 9) {
            break;
          }
          if (($strategy_addr | 0) < 0 | ($strategy_addr | 0) > 4) {
            break;
          }
          if (($windowBits_addr | 0) == 8) {
            $windowBits_addr = 9;
          }
          var $29 = HEAP[$strm_addr + 32 | 0];
          var $31 = HEAP[$strm_addr + 40 | 0];
          var $call = FUNCTION_TABLE[$29]($31, 1, 5828);
          var $32 = $call;
          $s = $32;
          if (($32 | 0) == 0) {
            $retval = -4;
            __label__ = 32;
            break $if_then$$lor_lhs_false$83;
          }
          HEAP[$strm_addr + 28 | 0] = $s;
          HEAP[$s | 0] = $strm_addr;
          HEAP[$s + 24 | 0] = $wrap;
          HEAP[$s + 28 | 0] = 0;
          HEAP[$s + 48 | 0] = $windowBits_addr;
          var $shl = 1 << HEAP[$s + 48 | 0];
          HEAP[$s + 44 | 0] = $shl;
          var $sub76 = HEAP[$s + 44 | 0] - 1 | 0;
          HEAP[$s + 52 | 0] = $sub76;
          HEAP[$s + 80 | 0] = $memLevel_addr + 7 | 0;
          var $shl78 = 1 << HEAP[$s + 80 | 0];
          HEAP[$s + 76 | 0] = $shl78;
          var $sub80 = HEAP[$s + 76 | 0] - 1 | 0;
          HEAP[$s + 84 | 0] = $sub80;
          var $sub83 = HEAP[$s + 80 | 0] + 2 | 0;
          var $div = Math.floor(($sub83 >>> 0) / 3);
          HEAP[$s + 88 | 0] = $div;
          var $60 = HEAP[$strm_addr + 32 | 0];
          var $62 = HEAP[$strm_addr + 40 | 0];
          var $64 = HEAP[$s + 44 | 0];
          var $call87 = FUNCTION_TABLE[$60]($62, $64, 2);
          HEAP[$s + 56 | 0] = $call87;
          var $67 = HEAP[$strm_addr + 32 | 0];
          var $69 = HEAP[$strm_addr + 40 | 0];
          var $71 = HEAP[$s + 44 | 0];
          var $call91 = FUNCTION_TABLE[$67]($69, $71, 2);
          var $72 = $call91;
          HEAP[$s + 64 | 0] = $72;
          var $76 = HEAP[$s + 64 | 0];
          var $mul = HEAP[$s + 44 | 0] << 1 | 0;
          for (var $$dest = $76, $$stop = $$dest + $mul; $$dest < $$stop; $$dest++) {
            HEAP[$$dest] = 0;
          }
          var $80 = HEAP[$strm_addr + 32 | 0];
          var $82 = HEAP[$strm_addr + 40 | 0];
          var $84 = HEAP[$s + 76 | 0];
          var $call97 = FUNCTION_TABLE[$80]($82, $84, 2);
          var $85 = $call97;
          HEAP[$s + 68 | 0] = $85;
          HEAP[$s + 5824 | 0] = 0;
          HEAP[$s + 5788 | 0] = 1 << $memLevel_addr + 6;
          var $91 = HEAP[$strm_addr + 32 | 0];
          var $93 = HEAP[$strm_addr + 40 | 0];
          var $95 = HEAP[$s + 5788 | 0];
          var $call103 = FUNCTION_TABLE[$91]($93, $95, 4);
          $overlay = $call103;
          HEAP[$s + 8 | 0] = $overlay;
          var $mul105 = HEAP[$s + 5788 | 0] << 2 | 0;
          HEAP[$s + 12 | 0] = $mul105;
          var $cmp107 = (HEAP[$s + 56 | 0] | 0) == 0;
          do {
            if (!$cmp107) {
              if ((HEAP[$s + 64 | 0] | 0) == 0) {
                break;
              }
              if ((HEAP[$s + 68 | 0] | 0) == 0) {
                break;
              }
              if ((HEAP[$s + 8 | 0] | 0) == 0) {
                break;
              }
              var $114 = $overlay;
              var $116 = HEAP[$s + 5788 | 0];
              var $div126 = Math.floor(($116 >>> 0) / 2);
              var $add_ptr = ($div126 << 1) + $114 | 0;
              HEAP[$s + 5796 | 0] = $add_ptr;
              var $add_ptr130 = HEAP[$s + 8 | 0] + HEAP[$s + 5788 | 0] * 3 | 0;
              HEAP[$s + 5784 | 0] = $add_ptr130;
              HEAP[$s + 132 | 0] = $level_addr;
              HEAP[$s + 136 | 0] = $strategy_addr;
              HEAP[$s + 36 | 0] = $method_addr & 255;
              var $call135 = _deflateReset($strm_addr);
              $retval = $call135;
              __label__ = 32;
              break $if_then$$lor_lhs_false$83;
            }
          } while (0);
          HEAP[$s + 4 | 0] = 666;
          HEAP[$strm_addr + 24 | 0] = STRING_TABLE.__str657 | 0;
          var $call123 = _deflateEnd($strm_addr);
          $retval = -4;
          __label__ = 32;
          break $if_then$$lor_lhs_false$83;
        }
      } while (0);
      $retval = -2;
      __label__ = 32;
      break;
    }
  } while (0);
  if (__label__ == 3) {
    $retval = -6;
  }
  return $retval;
  return null;
}

_deflateInit2_["X"] = 1;

function _deflateEnd($strm) {
  var __label__;
  var $retval;
  var $strm_addr;
  var $status;
  $strm_addr = $strm;
  var $cmp = ($strm_addr | 0) == 0;
  do {
    if ($cmp) {
      __label__ = 2;
    } else {
      if ((HEAP[$strm_addr + 28 | 0] | 0) == 0) {
        __label__ = 2;
        break;
      }
      $status = HEAP[HEAP[$strm_addr + 28 | 0] + 4 | 0];
      if (($status | 0) != 42 & ($status | 0) != 69 & ($status | 0) != 73 & ($status | 0) != 91 & ($status | 0) != 103 & ($status | 0) != 113 & ($status | 0) != 666) {
        $retval = -2;
        __label__ = 14;
        break;
      }
      if ((HEAP[HEAP[$strm_addr + 28 | 0] + 8 | 0] | 0) != 0) {
        var $17 = HEAP[$strm_addr + 36 | 0];
        var $19 = HEAP[$strm_addr + 40 | 0];
        var $22 = HEAP[HEAP[$strm_addr + 28 | 0] + 8 | 0];
        FUNCTION_TABLE[$17]($19, $22);
      }
      if ((HEAP[HEAP[$strm_addr + 28 | 0] + 68 | 0] | 0) != 0) {
        var $27 = HEAP[$strm_addr + 36 | 0];
        var $29 = HEAP[$strm_addr + 40 | 0];
        var $33 = HEAP[HEAP[$strm_addr + 28 | 0] + 68 | 0];
        FUNCTION_TABLE[$27]($29, $33);
      }
      if ((HEAP[HEAP[$strm_addr + 28 | 0] + 64 | 0] | 0) != 0) {
        var $38 = HEAP[$strm_addr + 36 | 0];
        var $40 = HEAP[$strm_addr + 40 | 0];
        var $44 = HEAP[HEAP[$strm_addr + 28 | 0] + 64 | 0];
        FUNCTION_TABLE[$38]($40, $44);
      }
      if ((HEAP[HEAP[$strm_addr + 28 | 0] + 56 | 0] | 0) != 0) {
        var $49 = HEAP[$strm_addr + 36 | 0];
        var $51 = HEAP[$strm_addr + 40 | 0];
        var $54 = HEAP[HEAP[$strm_addr + 28 | 0] + 56 | 0];
        FUNCTION_TABLE[$49]($51, $54);
      }
      var $56 = HEAP[$strm_addr + 36 | 0];
      var $58 = HEAP[$strm_addr + 40 | 0];
      var $61 = HEAP[$strm_addr + 28 | 0];
      FUNCTION_TABLE[$56]($58, $61);
      HEAP[$strm_addr + 28 | 0] = 0;
      var $cond = ($status | 0) == 113 ? -3 : 0;
      $retval = $cond;
      __label__ = 14;
      break;
    }
  } while (0);
  if (__label__ == 2) {
    $retval = -2;
  }
  return $retval;
  return null;
}

_deflateEnd["X"] = 1;

function _deflateReset($strm) {
  var __label__;
  var $retval;
  var $strm_addr;
  var $s;
  $strm_addr = $strm;
  var $cmp = ($strm_addr | 0) == 0;
  do {
    if (!$cmp) {
      if ((HEAP[$strm_addr + 28 | 0] | 0) == 0) {
        __label__ = 4;
        break;
      }
      if ((HEAP[$strm_addr + 32 | 0] | 0) == 0) {
        __label__ = 4;
        break;
      }
      if ((HEAP[$strm_addr + 36 | 0] | 0) == 0) {
        __label__ = 4;
        break;
      }
      HEAP[$strm_addr + 20 | 0] = 0;
      HEAP[$strm_addr + 8 | 0] = 0;
      HEAP[$strm_addr + 24 | 0] = 0;
      HEAP[$strm_addr + 44 | 0] = 2;
      $s = HEAP[$strm_addr + 28 | 0];
      HEAP[$s + 20 | 0] = 0;
      var $15 = HEAP[$s + 8 | 0];
      HEAP[$s + 16 | 0] = $15;
      if ((HEAP[$s + 24 | 0] | 0) < 0) {
        var $sub = -HEAP[$s + 24 | 0] | 0;
        HEAP[$s + 24 | 0] = $sub;
      }
      var $cond = (HEAP[$s + 24 | 0] | 0) != 0 ? 42 : 113;
      HEAP[$s + 4 | 0] = $cond;
      if ((HEAP[$s + 24 | 0] | 0) == 2) {
        var $call = _crc32(0, 0, 0);
        var $cond16 = $call;
      } else {
        var $call15 = _adler32(0, 0, 0);
        var $cond16 = $call15;
      }
      var $cond16;
      HEAP[$strm_addr + 48 | 0] = $cond16;
      HEAP[$s + 40 | 0] = 0;
      __tr_init($s);
      _lm_init($s);
      $retval = 0;
      __label__ = 11;
      break;
    }
    __label__ = 4;
  } while (0);
  if (__label__ == 4) {
    $retval = -2;
  }
  return $retval;
  return null;
}

_deflateReset["X"] = 1;

function _lm_init($s) {
  var $s_addr;
  $s_addr = $s;
  var $mul = HEAP[$s_addr + 44 | 0] << 1 | 0;
  HEAP[$s_addr + 60 | 0] = $mul;
  var $arrayidx = (HEAP[$s_addr + 76 | 0] - 1 << 1) + HEAP[$s_addr + 68 | 0] | 0;
  HEAP[$arrayidx] = 0;
  var $9 = HEAP[$s_addr + 68 | 0];
  var $mul4 = HEAP[$s_addr + 76 | 0] - 1 << 1 | 0;
  for (var $$dest = $9, $$stop = $$dest + $mul4; $$dest < $$stop; $$dest++) {
    HEAP[$$dest] = 0;
  }
  var $conv = HEAP[_configuration_table + HEAP[$s_addr + 132 | 0] * 12 + 2 | 0] & 65535;
  HEAP[$s_addr + 128 | 0] = $conv;
  var $conv8 = HEAP[_configuration_table + HEAP[$s_addr + 132 | 0] * 12 | 0] & 65535;
  HEAP[$s_addr + 140 | 0] = $conv8;
  var $conv11 = HEAP[_configuration_table + HEAP[$s_addr + 132 | 0] * 12 + 4 | 0] & 65535;
  HEAP[$s_addr + 144 | 0] = $conv11;
  var $conv14 = HEAP[_configuration_table + HEAP[$s_addr + 132 | 0] * 12 + 6 | 0] & 65535;
  HEAP[$s_addr + 124 | 0] = $conv14;
  HEAP[$s_addr + 108 | 0] = 0;
  HEAP[$s_addr + 92 | 0] = 0;
  HEAP[$s_addr + 116 | 0] = 0;
  HEAP[$s_addr + 120 | 0] = 2;
  HEAP[$s_addr + 96 | 0] = 2;
  HEAP[$s_addr + 112 | 0] = 0;
  HEAP[$s_addr + 104 | 0] = 0;
  HEAP[$s_addr + 72 | 0] = 0;
  return;
  return;
}

_lm_init["X"] = 1;

function _deflate($strm, $flush) {
  var __label__;
  var $retval;
  var $strm_addr;
  var $flush_addr;
  var $old_flush;
  var $s;
  var $header;
  var $level_flags;
  var $beg;
  var $beg329;
  var $val;
  var $beg408;
  var $val410;
  var $bstate;
  $strm_addr = $strm;
  $flush_addr = $flush;
  var $cmp = ($strm_addr | 0) == 0;
  $if_then$$lor_lhs_false$2 : do {
    if (!$cmp) {
      if ((HEAP[$strm_addr + 28 | 0] | 0) == 0) {
        __label__ = 3;
        break;
      }
      if (($flush_addr | 0) > 5 | ($flush_addr | 0) < 0) {
        __label__ = 3;
        break;
      }
      $s = HEAP[$strm_addr + 28 | 0];
      var $cmp7 = (HEAP[$strm_addr + 12 | 0] | 0) == 0;
      do {
        if (!$cmp7) {
          if ((HEAP[$strm_addr | 0] | 0) == 0) {
            if ((HEAP[$strm_addr + 4 | 0] | 0) != 0) {
              break;
            }
          }
          if ((HEAP[$s + 4 | 0] | 0) == 666) {
            if (($flush_addr | 0) != 4) {
              break;
            }
          }
          var $19 = $strm_addr;
          if ((HEAP[$strm_addr + 16 | 0] | 0) == 0) {
            HEAP[$19 + 24 | 0] = STRING_TABLE.__str758 | 0;
            $retval = -5;
            __label__ = 140;
            break $if_then$$lor_lhs_false$2;
          }
          HEAP[$s | 0] = $19;
          $old_flush = HEAP[$s + 40 | 0];
          HEAP[$s + 40 | 0] = $flush_addr;
          if ((HEAP[$s + 4 | 0] | 0) == 42) {
            if ((HEAP[$s + 24 | 0] | 0) == 2) {
              var $call = _crc32(0, 0, 0);
              HEAP[$strm_addr + 48 | 0] = $call;
              var $pending = $s + 20 | 0;
              var $31 = HEAP[$pending];
              var $inc = $31 + 1 | 0;
              HEAP[$pending] = $inc;
              var $arrayidx = HEAP[$s + 8 | 0] + $31 | 0;
              HEAP[$arrayidx] = 31;
              var $pending28 = $s + 20 | 0;
              var $35 = HEAP[$pending28];
              var $inc29 = $35 + 1 | 0;
              HEAP[$pending28] = $inc29;
              var $arrayidx31 = HEAP[$s + 8 | 0] + $35 | 0;
              HEAP[$arrayidx31] = -117;
              var $pending32 = $s + 20 | 0;
              var $39 = HEAP[$pending32];
              var $inc33 = $39 + 1 | 0;
              HEAP[$pending32] = $inc33;
              var $arrayidx35 = HEAP[$s + 8 | 0] + $39 | 0;
              HEAP[$arrayidx35] = 8;
              var $44 = $s;
              if ((HEAP[$s + 28 | 0] | 0) == 0) {
                var $pending38 = $44 + 20 | 0;
                var $45 = HEAP[$pending38];
                var $inc39 = $45 + 1 | 0;
                HEAP[$pending38] = $inc39;
                var $arrayidx41 = HEAP[$s + 8 | 0] + $45 | 0;
                HEAP[$arrayidx41] = 0;
                var $pending42 = $s + 20 | 0;
                var $49 = HEAP[$pending42];
                var $inc43 = $49 + 1 | 0;
                HEAP[$pending42] = $inc43;
                var $arrayidx45 = HEAP[$s + 8 | 0] + $49 | 0;
                HEAP[$arrayidx45] = 0;
                var $pending46 = $s + 20 | 0;
                var $53 = HEAP[$pending46];
                var $inc47 = $53 + 1 | 0;
                HEAP[$pending46] = $inc47;
                var $arrayidx49 = HEAP[$s + 8 | 0] + $53 | 0;
                HEAP[$arrayidx49] = 0;
                var $pending50 = $s + 20 | 0;
                var $57 = HEAP[$pending50];
                var $inc51 = $57 + 1 | 0;
                HEAP[$pending50] = $inc51;
                var $arrayidx53 = HEAP[$s + 8 | 0] + $57 | 0;
                HEAP[$arrayidx53] = 0;
                var $pending54 = $s + 20 | 0;
                var $61 = HEAP[$pending54];
                var $inc55 = $61 + 1 | 0;
                HEAP[$pending54] = $inc55;
                var $arrayidx57 = HEAP[$s + 8 | 0] + $61 | 0;
                HEAP[$arrayidx57] = 0;
                if ((HEAP[$s + 132 | 0] | 0) == 9) {
                  var $cond62 = 2;
                } else {
                  if ((HEAP[$s + 136 | 0] | 0) >= 2) {
                    var $70 = 1;
                  } else {
                    var $70 = (HEAP[$s + 132 | 0] | 0) < 2;
                  }
                  var $70;
                  var $cond = $70 ? 4 : 0;
                  var $cond62 = $cond;
                }
                var $cond62;
                var $pending63 = $s + 20 | 0;
                var $72 = HEAP[$pending63];
                var $inc64 = $72 + 1 | 0;
                HEAP[$pending63] = $inc64;
                var $arrayidx66 = HEAP[$s + 8 | 0] + $72 | 0;
                HEAP[$arrayidx66] = $cond62 & 255;
                var $pending67 = $s + 20 | 0;
                var $76 = HEAP[$pending67];
                var $inc68 = $76 + 1 | 0;
                HEAP[$pending67] = $inc68;
                var $arrayidx70 = HEAP[$s + 8 | 0] + $76 | 0;
                HEAP[$arrayidx70] = 3;
                HEAP[$s + 4 | 0] = 113;
              } else {
                var $cond73 = (HEAP[HEAP[$44 + 28 | 0] | 0] | 0) != 0 ? 1 : 0;
                var $cond76 = (HEAP[HEAP[$s + 28 | 0] + 44 | 0] | 0) != 0 ? 2 : 0;
                var $cond80 = (HEAP[HEAP[$s + 28 | 0] + 16 | 0] | 0) == 0 ? 0 : 4;
                var $cond85 = (HEAP[HEAP[$s + 28 | 0] + 28 | 0] | 0) == 0 ? 0 : 8;
                var $cond90 = (HEAP[HEAP[$s + 28 | 0] + 36 | 0] | 0) == 0 ? 0 : 16;
                var $conv92 = $cond76 + $cond73 + $cond80 + $cond85 + $cond90 & 255;
                var $pending93 = $s + 20 | 0;
                var $95 = HEAP[$pending93];
                var $inc94 = $95 + 1 | 0;
                HEAP[$pending93] = $inc94;
                var $arrayidx96 = HEAP[$s + 8 | 0] + $95 | 0;
                HEAP[$arrayidx96] = $conv92;
                var $conv98 = HEAP[HEAP[$s + 28 | 0] + 4 | 0] & 255 & 255;
                var $pending99 = $s + 20 | 0;
                var $102 = HEAP[$pending99];
                var $inc100 = $102 + 1 | 0;
                HEAP[$pending99] = $inc100;
                var $arrayidx102 = HEAP[$s + 8 | 0] + $102 | 0;
                HEAP[$arrayidx102] = $conv98;
                var $conv106 = HEAP[HEAP[$s + 28 | 0] + 4 | 0] >>> 8 & 255 & 255;
                var $pending107 = $s + 20 | 0;
                var $109 = HEAP[$pending107];
                var $inc108 = $109 + 1 | 0;
                HEAP[$pending107] = $inc108;
                var $arrayidx110 = HEAP[$s + 8 | 0] + $109 | 0;
                HEAP[$arrayidx110] = $conv106;
                var $conv115 = HEAP[HEAP[$s + 28 | 0] + 4 | 0] >>> 16 & 255 & 255;
                var $pending116 = $s + 20 | 0;
                var $116 = HEAP[$pending116];
                var $inc117 = $116 + 1 | 0;
                HEAP[$pending116] = $inc117;
                var $arrayidx119 = HEAP[$s + 8 | 0] + $116 | 0;
                HEAP[$arrayidx119] = $conv115;
                var $conv124 = HEAP[HEAP[$s + 28 | 0] + 4 | 0] >>> 24 & 255 & 255;
                var $pending125 = $s + 20 | 0;
                var $123 = HEAP[$pending125];
                var $inc126 = $123 + 1 | 0;
                HEAP[$pending125] = $inc126;
                var $arrayidx128 = HEAP[$s + 8 | 0] + $123 | 0;
                HEAP[$arrayidx128] = $conv124;
                if ((HEAP[$s + 132 | 0] | 0) == 9) {
                  var $cond144 = 2;
                } else {
                  if ((HEAP[$s + 136 | 0] | 0) >= 2) {
                    var $132 = 1;
                  } else {
                    var $132 = (HEAP[$s + 132 | 0] | 0) < 2;
                  }
                  var $132;
                  var $cond142 = $132 ? 4 : 0;
                  var $cond144 = $cond142;
                }
                var $cond144;
                var $pending146 = $s + 20 | 0;
                var $134 = HEAP[$pending146];
                var $inc147 = $134 + 1 | 0;
                HEAP[$pending146] = $inc147;
                var $arrayidx149 = HEAP[$s + 8 | 0] + $134 | 0;
                HEAP[$arrayidx149] = $cond144 & 255;
                var $conv152 = HEAP[HEAP[$s + 28 | 0] + 12 | 0] & 255 & 255;
                var $pending153 = $s + 20 | 0;
                var $141 = HEAP[$pending153];
                var $inc154 = $141 + 1 | 0;
                HEAP[$pending153] = $inc154;
                var $arrayidx156 = HEAP[$s + 8 | 0] + $141 | 0;
                HEAP[$arrayidx156] = $conv152;
                if ((HEAP[HEAP[$s + 28 | 0] + 16 | 0] | 0) != 0) {
                  var $conv164 = HEAP[HEAP[$s + 28 | 0] + 20 | 0] & 255 & 255;
                  var $pending165 = $s + 20 | 0;
                  var $151 = HEAP[$pending165];
                  var $inc166 = $151 + 1 | 0;
                  HEAP[$pending165] = $inc166;
                  var $arrayidx168 = HEAP[$s + 8 | 0] + $151 | 0;
                  HEAP[$arrayidx168] = $conv164;
                  var $conv173 = HEAP[HEAP[$s + 28 | 0] + 20 | 0] >>> 8 & 255 & 255;
                  var $pending174 = $s + 20 | 0;
                  var $158 = HEAP[$pending174];
                  var $inc175 = $158 + 1 | 0;
                  HEAP[$pending174] = $inc175;
                  var $arrayidx177 = HEAP[$s + 8 | 0] + $158 | 0;
                  HEAP[$arrayidx177] = $conv173;
                }
                if ((HEAP[HEAP[$s + 28 | 0] + 44 | 0] | 0) != 0) {
                  var $165 = HEAP[$strm_addr + 48 | 0];
                  var $167 = HEAP[$s + 8 | 0];
                  var $169 = HEAP[$s + 20 | 0];
                  var $call186 = _crc32($165, $167, $169);
                  HEAP[$strm_addr + 48 | 0] = $call186;
                }
                HEAP[$s + 32 | 0] = 0;
                HEAP[$s + 4 | 0] = 69;
              }
            } else {
              $header = (HEAP[$s + 48 | 0] - 8 << 4) + 8 << 8;
              var $cmp195 = (HEAP[$s + 136 | 0] | 0) >= 2;
              do {
                if ($cmp195) {
                  __label__ = 31;
                } else {
                  if ((HEAP[$s + 132 | 0] | 0) < 2) {
                    __label__ = 31;
                    break;
                  }
                  if ((HEAP[$s + 132 | 0] | 0) < 6) {
                    $level_flags = 1;
                    __label__ = 37;
                    break;
                  }
                  if ((HEAP[$s + 132 | 0] | 0) == 6) {
                    $level_flags = 2;
                    __label__ = 37;
                    break;
                  }
                  $level_flags = 3;
                  __label__ = 37;
                  break;
                }
              } while (0);
              if (__label__ == 31) {
                $level_flags = 0;
              }
              var $or = $header | $level_flags << 6;
              $header = $or;
              if ((HEAP[$s + 108 | 0] | 0) != 0) {
                var $or220 = $header | 32;
                $header = $or220;
              }
              var $add223 = -(($header >>> 0) % 31) + $header + 31 | 0;
              $header = $add223;
              HEAP[$s + 4 | 0] = 113;
              _putShortMSB($s, $header);
              if ((HEAP[$s + 108 | 0] | 0) != 0) {
                var $shr230 = HEAP[$strm_addr + 48 | 0] >>> 16;
                _putShortMSB($s, $shr230);
                var $and232 = HEAP[$strm_addr + 48 | 0] & 65535;
                _putShortMSB($s, $and232);
              }
              var $call234 = _adler32(0, 0, 0);
              HEAP[$strm_addr + 48 | 0] = $call234;
            }
          }
          var $cmp239 = (HEAP[$s + 4 | 0] | 0) == 69;
          do {
            if ($cmp239) {
              var $207 = $s;
              if ((HEAP[HEAP[$s + 28 | 0] + 16 | 0] | 0) != 0) {
                $beg = HEAP[$207 + 20 | 0];
                while (1) {
                  if (HEAP[$s + 32 | 0] >>> 0 >= (HEAP[HEAP[$s + 28 | 0] + 20 | 0] & 65535) >>> 0) {
                    break;
                  }
                  if ((HEAP[$s + 20 | 0] | 0) == (HEAP[$s + 12 | 0] | 0)) {
                    var $tobool260 = (HEAP[HEAP[$s + 28 | 0] + 44 | 0] | 0) != 0;
                    do {
                      if ($tobool260) {
                        if (HEAP[$s + 20 | 0] >>> 0 <= $beg >>> 0) {
                          break;
                        }
                        var $225 = HEAP[$strm_addr + 48 | 0];
                        var $add_ptr = HEAP[$s + 8 | 0] + $beg | 0;
                        var $sub269 = HEAP[$s + 20 | 0] - $beg | 0;
                        var $call270 = _crc32($225, $add_ptr, $sub269);
                        HEAP[$strm_addr + 48 | 0] = $call270;
                      }
                    } while (0);
                    _flush_pending($strm_addr);
                    $beg = HEAP[$s + 20 | 0];
                    if ((HEAP[$s + 20 | 0] | 0) == (HEAP[$s + 12 | 0] | 0)) {
                      break;
                    }
                  }
                  var $245 = HEAP[HEAP[HEAP[$s + 28 | 0] + 16 | 0] + HEAP[$s + 32 | 0] | 0];
                  var $pending285 = $s + 20 | 0;
                  var $247 = HEAP[$pending285];
                  var $inc286 = $247 + 1 | 0;
                  HEAP[$pending285] = $inc286;
                  var $arrayidx288 = HEAP[$s + 8 | 0] + $247 | 0;
                  HEAP[$arrayidx288] = $245;
                  var $gzindex289 = $s + 32 | 0;
                  var $inc290 = HEAP[$gzindex289] + 1 | 0;
                  HEAP[$gzindex289] = $inc290;
                }
                var $tobool293 = (HEAP[HEAP[$s + 28 | 0] + 44 | 0] | 0) != 0;
                do {
                  if ($tobool293) {
                    if (HEAP[$s + 20 | 0] >>> 0 <= $beg >>> 0) {
                      break;
                    }
                    var $259 = HEAP[$strm_addr + 48 | 0];
                    var $add_ptr301 = HEAP[$s + 8 | 0] + $beg | 0;
                    var $sub303 = HEAP[$s + 20 | 0] - $beg | 0;
                    var $call304 = _crc32($259, $add_ptr301, $sub303);
                    HEAP[$strm_addr + 48 | 0] = $call304;
                  }
                } while (0);
                if ((HEAP[$s + 32 | 0] | 0) != (HEAP[HEAP[$s + 28 | 0] + 20 | 0] | 0)) {
                  break;
                }
                HEAP[$s + 32 | 0] = 0;
                HEAP[$s + 4 | 0] = 73;
              } else {
                HEAP[$207 + 4 | 0] = 73;
              }
            }
          } while (0);
          var $cmp321 = (HEAP[$s + 4 | 0] | 0) == 73;
          do {
            if ($cmp321) {
              var $279 = $s;
              if ((HEAP[HEAP[$s + 28 | 0] + 28 | 0] | 0) != 0) {
                $beg329 = HEAP[$279 + 20 | 0];
                $do_body$88 : while (1) {
                  var $cmp333 = (HEAP[$s + 20 | 0] | 0) == (HEAP[$s + 12 | 0] | 0);
                  do {
                    if ($cmp333) {
                      var $tobool338 = (HEAP[HEAP[$s + 28 | 0] + 44 | 0] | 0) != 0;
                      do {
                        if ($tobool338) {
                          if (HEAP[$s + 20 | 0] >>> 0 <= $beg329 >>> 0) {
                            break;
                          }
                          var $292 = HEAP[$strm_addr + 48 | 0];
                          var $add_ptr346 = HEAP[$s + 8 | 0] + $beg329 | 0;
                          var $sub348 = HEAP[$s + 20 | 0] - $beg329 | 0;
                          var $call349 = _crc32($292, $add_ptr346, $sub348);
                          HEAP[$strm_addr + 48 | 0] = $call349;
                        }
                      } while (0);
                      _flush_pending($strm_addr);
                      $beg329 = HEAP[$s + 20 | 0];
                      if ((HEAP[$s + 20 | 0] | 0) != (HEAP[$s + 12 | 0] | 0)) {
                        break;
                      }
                      $val = 1;
                      break $do_body$88;
                    }
                  } while (0);
                  var $gzindex360 = $s + 32 | 0;
                  var $308 = HEAP[$gzindex360];
                  var $inc361 = $308 + 1 | 0;
                  HEAP[$gzindex360] = $inc361;
                  $val = HEAP[HEAP[HEAP[$s + 28 | 0] + 28 | 0] + $308 | 0] & 255;
                  var $pending367 = $s + 20 | 0;
                  var $315 = HEAP[$pending367];
                  var $inc368 = $315 + 1 | 0;
                  HEAP[$pending367] = $inc368;
                  var $arrayidx370 = HEAP[$s + 8 | 0] + $315 | 0;
                  HEAP[$arrayidx370] = $val & 255;
                  if (($val | 0) == 0) {
                    break;
                  }
                }
                var $tobool375 = (HEAP[HEAP[$s + 28 | 0] + 44 | 0] | 0) != 0;
                do {
                  if ($tobool375) {
                    if (HEAP[$s + 20 | 0] >>> 0 <= $beg329 >>> 0) {
                      break;
                    }
                    var $326 = HEAP[$strm_addr + 48 | 0];
                    var $add_ptr383 = HEAP[$s + 8 | 0] + $beg329 | 0;
                    var $sub385 = HEAP[$s + 20 | 0] - $beg329 | 0;
                    var $call386 = _crc32($326, $add_ptr383, $sub385);
                    HEAP[$strm_addr + 48 | 0] = $call386;
                  }
                } while (0);
                if (($val | 0) != 0) {
                  break;
                }
                HEAP[$s + 32 | 0] = 0;
                HEAP[$s + 4 | 0] = 91;
              } else {
                HEAP[$279 + 4 | 0] = 91;
              }
            }
          } while (0);
          var $cmp400 = (HEAP[$s + 4 | 0] | 0) == 91;
          do {
            if ($cmp400) {
              var $342 = $s;
              if ((HEAP[HEAP[$s + 28 | 0] + 36 | 0] | 0) != 0) {
                $beg408 = HEAP[$342 + 20 | 0];
                $do_body411$110 : while (1) {
                  var $cmp414 = (HEAP[$s + 20 | 0] | 0) == (HEAP[$s + 12 | 0] | 0);
                  do {
                    if ($cmp414) {
                      var $tobool419 = (HEAP[HEAP[$s + 28 | 0] + 44 | 0] | 0) != 0;
                      do {
                        if ($tobool419) {
                          if (HEAP[$s + 20 | 0] >>> 0 <= $beg408 >>> 0) {
                            break;
                          }
                          var $355 = HEAP[$strm_addr + 48 | 0];
                          var $add_ptr427 = HEAP[$s + 8 | 0] + $beg408 | 0;
                          var $sub429 = HEAP[$s + 20 | 0] - $beg408 | 0;
                          var $call430 = _crc32($355, $add_ptr427, $sub429);
                          HEAP[$strm_addr + 48 | 0] = $call430;
                        }
                      } while (0);
                      _flush_pending($strm_addr);
                      $beg408 = HEAP[$s + 20 | 0];
                      if ((HEAP[$s + 20 | 0] | 0) != (HEAP[$s + 12 | 0] | 0)) {
                        break;
                      }
                      $val410 = 1;
                      break $do_body411$110;
                    }
                  } while (0);
                  var $gzindex441 = $s + 32 | 0;
                  var $371 = HEAP[$gzindex441];
                  var $inc442 = $371 + 1 | 0;
                  HEAP[$gzindex441] = $inc442;
                  $val410 = HEAP[HEAP[HEAP[$s + 28 | 0] + 36 | 0] + $371 | 0] & 255;
                  var $pending448 = $s + 20 | 0;
                  var $378 = HEAP[$pending448];
                  var $inc449 = $378 + 1 | 0;
                  HEAP[$pending448] = $inc449;
                  var $arrayidx451 = HEAP[$s + 8 | 0] + $378 | 0;
                  HEAP[$arrayidx451] = $val410 & 255;
                  if (($val410 | 0) == 0) {
                    break;
                  }
                }
                var $tobool458 = (HEAP[HEAP[$s + 28 | 0] + 44 | 0] | 0) != 0;
                do {
                  if ($tobool458) {
                    if (HEAP[$s + 20 | 0] >>> 0 <= $beg408 >>> 0) {
                      break;
                    }
                    var $389 = HEAP[$strm_addr + 48 | 0];
                    var $add_ptr466 = HEAP[$s + 8 | 0] + $beg408 | 0;
                    var $sub468 = HEAP[$s + 20 | 0] - $beg408 | 0;
                    var $call469 = _crc32($389, $add_ptr466, $sub468);
                    HEAP[$strm_addr + 48 | 0] = $call469;
                  }
                } while (0);
                if (($val410 | 0) != 0) {
                  break;
                }
                HEAP[$s + 4 | 0] = 103;
              } else {
                HEAP[$342 + 4 | 0] = 103;
              }
            }
          } while (0);
          var $cmp482 = (HEAP[$s + 4 | 0] | 0) == 103;
          do {
            if ($cmp482) {
              var $404 = $s;
              if ((HEAP[HEAP[$s + 28 | 0] + 44 | 0] | 0) != 0) {
                if ((HEAP[$404 + 20 | 0] + 2 | 0) >>> 0 > HEAP[$s + 12 | 0] >>> 0) {
                  _flush_pending($strm_addr);
                }
                if (!((HEAP[$s + 20 | 0] + 2 | 0) >>> 0 <= HEAP[$s + 12 | 0] >>> 0)) {
                  break;
                }
                var $conv504 = HEAP[$strm_addr + 48 | 0] & 255 & 255;
                var $pending505 = $s + 20 | 0;
                var $416 = HEAP[$pending505];
                var $inc506 = $416 + 1 | 0;
                HEAP[$pending505] = $inc506;
                var $arrayidx508 = HEAP[$s + 8 | 0] + $416 | 0;
                HEAP[$arrayidx508] = $conv504;
                var $conv512 = HEAP[$strm_addr + 48 | 0] >>> 8 & 255 & 255;
                var $pending513 = $s + 20 | 0;
                var $422 = HEAP[$pending513];
                var $inc514 = $422 + 1 | 0;
                HEAP[$pending513] = $inc514;
                var $arrayidx516 = HEAP[$s + 8 | 0] + $422 | 0;
                HEAP[$arrayidx516] = $conv512;
                var $call517 = _crc32(0, 0, 0);
                HEAP[$strm_addr + 48 | 0] = $call517;
                HEAP[$s + 4 | 0] = 113;
              } else {
                HEAP[$404 + 4 | 0] = 113;
              }
            }
          } while (0);
          var $cmp526 = (HEAP[$s + 20 | 0] | 0) != 0;
          var $429 = $strm_addr;
          do {
            if ($cmp526) {
              _flush_pending($429);
              if ((HEAP[$strm_addr + 16 | 0] | 0) != 0) {
                break;
              }
              HEAP[$s + 40 | 0] = -1;
              $retval = 0;
              __label__ = 140;
              break $if_then$$lor_lhs_false$2;
            }
            if ((HEAP[$429 + 4 | 0] | 0) != 0) {
              break;
            }
            if (!(($flush_addr | 0) <= ($old_flush | 0) & ($flush_addr | 0) != 4)) {
              break;
            }
            HEAP[$strm_addr + 24 | 0] = STRING_TABLE.__str758 | 0;
            $retval = -5;
            __label__ = 140;
            break $if_then$$lor_lhs_false$2;
          } while (0);
          var $cmp550 = (HEAP[$s + 4 | 0] | 0) == 666;
          do {
            if ($cmp550) {
              if ((HEAP[$strm_addr + 4 | 0] | 0) == 0) {
                break;
              }
              HEAP[$strm_addr + 24 | 0] = STRING_TABLE.__str758 | 0;
              $retval = -5;
              __label__ = 140;
              break $if_then$$lor_lhs_false$2;
            }
          } while (0);
          var $cmp560 = (HEAP[$strm_addr + 4 | 0] | 0) != 0;
          do {
            if ($cmp560) {
              __label__ = 110;
            } else {
              if ((HEAP[$s + 116 | 0] | 0) != 0) {
                __label__ = 110;
                break;
              }
              if (($flush_addr | 0) == 0) {
                __label__ = 131;
                break;
              }
              if ((HEAP[$s + 4 | 0] | 0) != 666) {
                __label__ = 110;
                break;
              }
              __label__ = 130;
              break;
            }
          } while (0);
          do {
            if (__label__ == 110) {
              var $452 = $s;
              if ((HEAP[$s + 136 | 0] | 0) == 2) {
                var $call577 = _deflate_huff($452, $flush_addr);
                var $cond591 = $call577;
              } else {
                var $455 = $s;
                if ((HEAP[$452 + 136 | 0] | 0) == 3) {
                  var $call583 = _deflate_rle($455, $flush_addr);
                  var $cond591 = $call583;
                } else {
                  var $458 = HEAP[_configuration_table + HEAP[$455 + 132 | 0] * 12 + 8 | 0];
                  var $call587 = FUNCTION_TABLE[$458]($s, $flush_addr);
                  var $cond591 = $call587;
                }
              }
              var $cond591;
              $bstate = $cond591;
              if (($bstate | 0) == 2 | ($bstate | 0) == 3) {
                HEAP[$s + 4 | 0] = 666;
              }
              if (($bstate | 0) == 0 | ($bstate | 0) == 2) {
                if ((HEAP[$strm_addr + 16 | 0] | 0) == 0) {
                  HEAP[$s + 40 | 0] = -1;
                }
                $retval = 0;
                __label__ = 140;
                break $if_then$$lor_lhs_false$2;
              }
              if (($bstate | 0) != 1) {
                __label__ = 130;
                break;
              }
              var $cmp616 = ($flush_addr | 0) == 1;
              do {
                if ($cmp616) {
                  __tr_align($s);
                } else {
                  if (($flush_addr | 0) == 5) {
                    break;
                  }
                  __tr_stored_block($s, 0, 0, 0);
                  if (($flush_addr | 0) != 3) {
                    break;
                  }
                  var $arrayidx627 = (HEAP[$s + 76 | 0] - 1 << 1) + HEAP[$s + 68 | 0] | 0;
                  HEAP[$arrayidx627] = 0;
                  var $481 = HEAP[$s + 68 | 0];
                  var $mul = HEAP[$s + 76 | 0] - 1 << 1 | 0;
                  for (var $$dest = $481, $$stop = $$dest + $mul; $$dest < $$stop; $$dest++) {
                    HEAP[$$dest] = 0;
                  }
                  if ((HEAP[$s + 116 | 0] | 0) != 0) {
                    break;
                  }
                  HEAP[$s + 108 | 0] = 0;
                  HEAP[$s + 92 | 0] = 0;
                }
              } while (0);
              _flush_pending($strm_addr);
              if ((HEAP[$strm_addr + 16 | 0] | 0) != 0) {
                __label__ = 130;
                break;
              }
              HEAP[$s + 40 | 0] = -1;
              $retval = 0;
              __label__ = 140;
              break $if_then$$lor_lhs_false$2;
            }
          } while (0);
          do {
            if (__label__ == 130) {
              if (($flush_addr | 0) != 4) {
                break;
              }
              if ((HEAP[$s + 24 | 0] | 0) <= 0) {
                $retval = 1;
                __label__ = 140;
                break $if_then$$lor_lhs_false$2;
              }
              if ((HEAP[$s + 24 | 0] | 0) == 2) {
                var $conv663 = HEAP[$strm_addr + 48 | 0] & 255 & 255;
                var $pending664 = $s + 20 | 0;
                var $499 = HEAP[$pending664];
                var $inc665 = $499 + 1 | 0;
                HEAP[$pending664] = $inc665;
                var $arrayidx667 = HEAP[$s + 8 | 0] + $499 | 0;
                HEAP[$arrayidx667] = $conv663;
                var $conv671 = HEAP[$strm_addr + 48 | 0] >>> 8 & 255 & 255;
                var $pending672 = $s + 20 | 0;
                var $505 = HEAP[$pending672];
                var $inc673 = $505 + 1 | 0;
                HEAP[$pending672] = $inc673;
                var $arrayidx675 = HEAP[$s + 8 | 0] + $505 | 0;
                HEAP[$arrayidx675] = $conv671;
                var $conv679 = HEAP[$strm_addr + 48 | 0] >>> 16 & 255 & 255;
                var $pending680 = $s + 20 | 0;
                var $511 = HEAP[$pending680];
                var $inc681 = $511 + 1 | 0;
                HEAP[$pending680] = $inc681;
                var $arrayidx683 = HEAP[$s + 8 | 0] + $511 | 0;
                HEAP[$arrayidx683] = $conv679;
                var $conv687 = HEAP[$strm_addr + 48 | 0] >>> 24 & 255 & 255;
                var $pending688 = $s + 20 | 0;
                var $517 = HEAP[$pending688];
                var $inc689 = $517 + 1 | 0;
                HEAP[$pending688] = $inc689;
                var $arrayidx691 = HEAP[$s + 8 | 0] + $517 | 0;
                HEAP[$arrayidx691] = $conv687;
                var $conv693 = HEAP[$strm_addr + 8 | 0] & 255 & 255;
                var $pending694 = $s + 20 | 0;
                var $523 = HEAP[$pending694];
                var $inc695 = $523 + 1 | 0;
                HEAP[$pending694] = $inc695;
                var $arrayidx697 = HEAP[$s + 8 | 0] + $523 | 0;
                HEAP[$arrayidx697] = $conv693;
                var $conv701 = HEAP[$strm_addr + 8 | 0] >>> 8 & 255 & 255;
                var $pending702 = $s + 20 | 0;
                var $529 = HEAP[$pending702];
                var $inc703 = $529 + 1 | 0;
                HEAP[$pending702] = $inc703;
                var $arrayidx705 = HEAP[$s + 8 | 0] + $529 | 0;
                HEAP[$arrayidx705] = $conv701;
                var $conv709 = HEAP[$strm_addr + 8 | 0] >>> 16 & 255 & 255;
                var $pending710 = $s + 20 | 0;
                var $535 = HEAP[$pending710];
                var $inc711 = $535 + 1 | 0;
                HEAP[$pending710] = $inc711;
                var $arrayidx713 = HEAP[$s + 8 | 0] + $535 | 0;
                HEAP[$arrayidx713] = $conv709;
                var $conv717 = HEAP[$strm_addr + 8 | 0] >>> 24 & 255 & 255;
                var $pending718 = $s + 20 | 0;
                var $541 = HEAP[$pending718];
                var $inc719 = $541 + 1 | 0;
                HEAP[$pending718] = $inc719;
                var $arrayidx721 = HEAP[$s + 8 | 0] + $541 | 0;
                HEAP[$arrayidx721] = $conv717;
              } else {
                var $shr724 = HEAP[$strm_addr + 48 | 0] >>> 16;
                _putShortMSB($s, $shr724);
                var $and726 = HEAP[$strm_addr + 48 | 0] & 65535;
                _putShortMSB($s, $and726);
              }
              _flush_pending($strm_addr);
              if ((HEAP[$s + 24 | 0] | 0) > 0) {
                var $sub733 = -HEAP[$s + 24 | 0] | 0;
                HEAP[$s + 24 | 0] = $sub733;
              }
              var $cond739 = (HEAP[$s + 20 | 0] | 0) != 0 ? 0 : 1;
              $retval = $cond739;
              __label__ = 140;
              break $if_then$$lor_lhs_false$2;
            }
          } while (0);
          $retval = 0;
          __label__ = 140;
          break $if_then$$lor_lhs_false$2;
        }
      } while (0);
      HEAP[$strm_addr + 24 | 0] = STRING_TABLE.__str455 | 0;
      $retval = -2;
      __label__ = 140;
      break;
    }
    __label__ = 3;
  } while (0);
  if (__label__ == 3) {
    $retval = -2;
  }
  return $retval;
  return null;
}

_deflate["X"] = 1;

function _putShortMSB($s, $b) {
  var $s_addr;
  var $b_addr;
  $s_addr = $s;
  $b_addr = $b;
  var $pending = $s_addr + 20 | 0;
  var $2 = HEAP[$pending];
  var $inc = $2 + 1 | 0;
  HEAP[$pending] = $inc;
  var $arrayidx = HEAP[$s_addr + 8 | 0] + $2 | 0;
  HEAP[$arrayidx] = $b_addr >>> 8 & 255;
  var $pending2 = $s_addr + 20 | 0;
  var $7 = HEAP[$pending2];
  var $inc3 = $7 + 1 | 0;
  HEAP[$pending2] = $inc3;
  var $arrayidx5 = HEAP[$s_addr + 8 | 0] + $7 | 0;
  HEAP[$arrayidx5] = $b_addr & 255 & 255;
  return;
  return;
}

function _flush_pending($strm) {
  var $strm_addr;
  var $len;
  $strm_addr = $strm;
  $len = HEAP[HEAP[$strm_addr + 28 | 0] + 20 | 0];
  var $3 = $len;
  if ($3 >>> 0 > HEAP[$strm_addr + 16 | 0] >>> 0) {
    var $7 = HEAP[$strm_addr + 16 | 0];
    $len = $7;
    var $8 = $7;
  } else {
    var $8 = $3;
  }
  var $8;
  var $cmp2 = ($8 | 0) == 0;
  do {
    if (!$cmp2) {
      var $10 = HEAP[$strm_addr + 12 | 0];
      var $13 = HEAP[HEAP[$strm_addr + 28 | 0] + 16 | 0];
      var $14 = $len;
      for (var $$src = $13, $$dest = $10, $$stop = $$src + $14; $$src < $$stop; $$src++, $$dest++) {
        HEAP[$$dest] = HEAP[$$src];
      }
      var $next_out6 = $strm_addr + 12 | 0;
      var $add_ptr = HEAP[$next_out6] + $len | 0;
      HEAP[$next_out6] = $add_ptr;
      var $pending_out8 = HEAP[$strm_addr + 28 | 0] + 16 | 0;
      var $add_ptr9 = HEAP[$pending_out8] + $len | 0;
      HEAP[$pending_out8] = $add_ptr9;
      var $total_out = $strm_addr + 20 | 0;
      var $add = HEAP[$total_out] + $len | 0;
      HEAP[$total_out] = $add;
      var $avail_out10 = $strm_addr + 16 | 0;
      var $sub = HEAP[$avail_out10] - $len | 0;
      HEAP[$avail_out10] = $sub;
      var $pending12 = HEAP[$strm_addr + 28 | 0] + 20 | 0;
      var $sub13 = HEAP[$pending12] - $len | 0;
      HEAP[$pending12] = $sub13;
      if ((HEAP[HEAP[$strm_addr + 28 | 0] + 20 | 0] | 0) != 0) {
        break;
      }
      var $37 = HEAP[HEAP[$strm_addr + 28 | 0] + 8 | 0];
      var $pending_out20 = HEAP[$strm_addr + 28 | 0] + 16 | 0;
      HEAP[$pending_out20] = $37;
    }
  } while (0);
  return;
  return;
}

_flush_pending["X"] = 1;

function _deflate_huff($s, $flush) {
  var $retval;
  var $s_addr;
  var $flush_addr;
  var $bflush;
  var $cc;
  $s_addr = $s;
  $flush_addr = $flush;
  $for_cond$11 : while (1) {
    var $cmp = (HEAP[$s_addr + 116 | 0] | 0) == 0;
    do {
      if ($cmp) {
        _fill_window($s_addr);
        if ((HEAP[$s_addr + 116 | 0] | 0) != 0) {
          break;
        }
        if (($flush_addr | 0) == 0) {
          $retval = 0;
          break $for_cond$11;
        }
        if ((HEAP[$s_addr + 92 | 0] | 0) >= 0) {
          var $cond44 = HEAP[$s_addr + 56 | 0] + HEAP[$s_addr + 92 | 0] | 0;
        } else {
          var $cond44 = 0;
        }
        var $cond44;
        var $sub47 = HEAP[$s_addr + 108 | 0] - HEAP[$s_addr + 92 | 0] | 0;
        __tr_flush_block($s_addr, $cond44, $sub47, ($flush_addr | 0) == 4 & 1);
        var $65 = HEAP[$s_addr + 108 | 0];
        HEAP[$s_addr + 92 | 0] = $65;
        var $68 = HEAP[$s_addr | 0];
        _flush_pending($68);
        var $cmp58 = ($flush_addr | 0) == 4;
        if ((HEAP[HEAP[$s_addr | 0] + 16 | 0] | 0) == 0) {
          var $cond60 = $cmp58 ? 2 : 0;
          $retval = $cond60;
          break $for_cond$11;
        }
        var $cond64 = $cmp58 ? 3 : 1;
        $retval = $cond64;
        break $for_cond$11;
      }
    } while (0);
    HEAP[$s_addr + 96 | 0] = 0;
    $cc = HEAP[HEAP[$s_addr + 56 | 0] + HEAP[$s_addr + 108 | 0] | 0];
    var $arrayidx8 = (HEAP[$s_addr + 5792 | 0] << 1) + HEAP[$s_addr + 5796 | 0] | 0;
    HEAP[$arrayidx8] = 0;
    var $last_lit9 = $s_addr + 5792 | 0;
    var $18 = HEAP[$last_lit9];
    var $inc = $18 + 1 | 0;
    HEAP[$last_lit9] = $inc;
    var $arrayidx10 = HEAP[$s_addr + 5784 | 0] + $18 | 0;
    HEAP[$arrayidx10] = $cc;
    var $freq = (($cc & 255) << 2) + $s_addr + 148 | 0;
    var $inc12 = HEAP[$freq] + 1 & 65535;
    HEAP[$freq] = $inc12;
    $bflush = (HEAP[$s_addr + 5792 | 0] | 0) == (HEAP[$s_addr + 5788 | 0] - 1 | 0) & 1;
    var $lookahead15 = $s_addr + 116 | 0;
    var $dec = HEAP[$lookahead15] - 1 | 0;
    HEAP[$lookahead15] = $dec;
    var $strstart16 = $s_addr + 108 | 0;
    var $inc17 = HEAP[$strstart16] + 1 | 0;
    HEAP[$strstart16] = $inc17;
    if (($bflush | 0) == 0) {
      continue;
    }
    if ((HEAP[$s_addr + 92 | 0] | 0) >= 0) {
      var $cond = HEAP[$s_addr + 56 | 0] + HEAP[$s_addr + 92 | 0] | 0;
    } else {
      var $cond = 0;
    }
    var $cond;
    var $sub26 = HEAP[$s_addr + 108 | 0] - HEAP[$s_addr + 92 | 0] | 0;
    __tr_flush_block($s_addr, $cond, $sub26, 0);
    var $45 = HEAP[$s_addr + 108 | 0];
    HEAP[$s_addr + 92 | 0] = $45;
    var $48 = HEAP[$s_addr | 0];
    _flush_pending($48);
    if ((HEAP[HEAP[$s_addr | 0] + 16 | 0] | 0) != 0) {
      continue;
    }
    $retval = 0;
    break;
  }
  return $retval;
  return null;
}

_deflate_huff["X"] = 1;

function _deflate_rle($s, $flush) {
  var $retval;
  var $s_addr;
  var $flush_addr;
  var $bflush;
  var $prev;
  var $scan;
  var $strend;
  var $len;
  var $dist;
  var $cc;
  $s_addr = $s;
  $flush_addr = $flush;
  $for_cond$33 : while (1) {
    var $cmp = HEAP[$s_addr + 116 | 0] >>> 0 < 258;
    do {
      if ($cmp) {
        _fill_window($s_addr);
        var $cmp2 = HEAP[$s_addr + 116 | 0] >>> 0 < 258;
        do {
          if ($cmp2) {
            if (($flush_addr | 0) != 0) {
              break;
            }
            $retval = 0;
            break $for_cond$33;
          }
        } while (0);
        if ((HEAP[$s_addr + 116 | 0] | 0) != 0) {
          break;
        }
        if ((HEAP[$s_addr + 92 | 0] | 0) >= 0) {
          var $cond182 = HEAP[$s_addr + 56 | 0] + HEAP[$s_addr + 92 | 0] | 0;
        } else {
          var $cond182 = 0;
        }
        var $cond182;
        var $sub185 = HEAP[$s_addr + 108 | 0] - HEAP[$s_addr + 92 | 0] | 0;
        __tr_flush_block($s_addr, $cond182, $sub185, ($flush_addr | 0) == 4 & 1);
        var $163 = HEAP[$s_addr + 108 | 0];
        HEAP[$s_addr + 92 | 0] = $163;
        var $166 = HEAP[$s_addr | 0];
        _flush_pending($166);
        var $cmp196 = ($flush_addr | 0) == 4;
        if ((HEAP[HEAP[$s_addr | 0] + 16 | 0] | 0) == 0) {
          var $cond198 = $cmp196 ? 2 : 0;
          $retval = $cond198;
          break $for_cond$33;
        }
        var $cond202 = $cmp196 ? 3 : 1;
        $retval = $cond202;
        break $for_cond$33;
      }
    } while (0);
    HEAP[$s_addr + 96 | 0] = 0;
    var $cmp11 = HEAP[$s_addr + 116 | 0] >>> 0 >= 3;
    do {
      if ($cmp11) {
        if (HEAP[$s_addr + 108 | 0] >>> 0 <= 0) {
          break;
        }
        $scan = HEAP[$s_addr + 56 | 0] + HEAP[$s_addr + 108 | 0] - 1 | 0;
        $prev = HEAP[$scan] & 255;
        var $incdec_ptr = $scan + 1 | 0;
        $scan = $incdec_ptr;
        if (($prev | 0) != (HEAP[$incdec_ptr] & 255 | 0)) {
          break;
        }
        var $incdec_ptr21 = $scan + 1 | 0;
        $scan = $incdec_ptr21;
        if (($prev | 0) != (HEAP[$incdec_ptr21] & 255 | 0)) {
          break;
        }
        var $incdec_ptr26 = $scan + 1 | 0;
        $scan = $incdec_ptr26;
        if (($prev | 0) != (HEAP[$incdec_ptr26] & 255 | 0)) {
          break;
        }
        $strend = HEAP[$s_addr + 56 | 0] + HEAP[$s_addr + 108 | 0] + 258 | 0;
        while (1) {
          var $incdec_ptr35 = $scan + 1 | 0;
          $scan = $incdec_ptr35;
          if (($prev | 0) != (HEAP[$incdec_ptr35] & 255 | 0)) {
            break;
          }
          var $incdec_ptr40 = $scan + 1 | 0;
          $scan = $incdec_ptr40;
          if (($prev | 0) != (HEAP[$incdec_ptr40] & 255 | 0)) {
            break;
          }
          var $incdec_ptr45 = $scan + 1 | 0;
          $scan = $incdec_ptr45;
          if (($prev | 0) != (HEAP[$incdec_ptr45] & 255 | 0)) {
            break;
          }
          var $incdec_ptr50 = $scan + 1 | 0;
          $scan = $incdec_ptr50;
          if (($prev | 0) != (HEAP[$incdec_ptr50] & 255 | 0)) {
            break;
          }
          var $incdec_ptr55 = $scan + 1 | 0;
          $scan = $incdec_ptr55;
          if (($prev | 0) != (HEAP[$incdec_ptr55] & 255 | 0)) {
            break;
          }
          var $incdec_ptr60 = $scan + 1 | 0;
          $scan = $incdec_ptr60;
          if (($prev | 0) != (HEAP[$incdec_ptr60] & 255 | 0)) {
            break;
          }
          var $incdec_ptr65 = $scan + 1 | 0;
          $scan = $incdec_ptr65;
          if (($prev | 0) != (HEAP[$incdec_ptr65] & 255 | 0)) {
            break;
          }
          var $incdec_ptr70 = $scan + 1 | 0;
          $scan = $incdec_ptr70;
          if (($prev | 0) != (HEAP[$incdec_ptr70] & 255 | 0)) {
            break;
          }
          if ($scan >>> 0 >= $strend >>> 0) {
            break;
          }
        }
        HEAP[$s_addr + 96 | 0] = -$strend + -(-$scan) + 258 | 0;
        if (HEAP[$s_addr + 96 | 0] >>> 0 <= HEAP[$s_addr + 116 | 0] >>> 0) {
          break;
        }
        var $66 = HEAP[$s_addr + 116 | 0];
        HEAP[$s_addr + 96 | 0] = $66;
      }
    } while (0);
    var $70 = $s_addr;
    if (HEAP[$s_addr + 96 | 0] >>> 0 >= 3) {
      $len = HEAP[$70 + 96 | 0] - 3 & 255;
      $dist = 1;
      var $arrayidx = (HEAP[$s_addr + 5792 | 0] << 1) + HEAP[$s_addr + 5796 | 0] | 0;
      HEAP[$arrayidx] = $dist;
      var $last_lit94 = $s_addr + 5792 | 0;
      var $79 = HEAP[$last_lit94];
      var $inc = $79 + 1 | 0;
      HEAP[$last_lit94] = $inc;
      var $arrayidx95 = HEAP[$s_addr + 5784 | 0] + $79 | 0;
      HEAP[$arrayidx95] = $len;
      var $dec = $dist - 1 & 65535;
      $dist = $dec;
      var $arrayidx96 = STRING_TABLE.__length_code + ($len & 255) | 0;
      var $freq = ((HEAP[$arrayidx96] & 255) + 257 << 2) + $s_addr + 148 | 0;
      var $inc100 = HEAP[$freq] + 1 & 65535;
      HEAP[$freq] = $inc100;
      var $idxprom104 = $dist & 65535;
      if (($dist & 65535 | 0) < 256) {
        var $arrayidx105 = STRING_TABLE.__dist_code + $idxprom104 | 0;
        var $cond = HEAP[$arrayidx105] & 255;
      } else {
        var $arrayidx109 = ($idxprom104 >> 7) + STRING_TABLE.__dist_code + 256 | 0;
        var $cond = HEAP[$arrayidx109] & 255;
      }
      var $cond;
      var $freq113 = ($cond << 2) + $s_addr + 2440 | 0;
      var $inc114 = HEAP[$freq113] + 1 & 65535;
      HEAP[$freq113] = $inc114;
      $bflush = (HEAP[$s_addr + 5792 | 0] | 0) == (HEAP[$s_addr + 5788 | 0] - 1 | 0) & 1;
      var $lookahead120 = $s_addr + 116 | 0;
      var $sub121 = HEAP[$lookahead120] - HEAP[$s_addr + 96 | 0] | 0;
      HEAP[$lookahead120] = $sub121;
      var $strstart123 = $s_addr + 108 | 0;
      var $add124 = HEAP[$strstart123] + HEAP[$s_addr + 96 | 0] | 0;
      HEAP[$strstart123] = $add124;
      HEAP[$s_addr + 96 | 0] = 0;
    } else {
      $cc = HEAP[HEAP[$s_addr + 56 | 0] + HEAP[$70 + 108 | 0] | 0];
      var $arrayidx131 = (HEAP[$s_addr + 5792 | 0] << 1) + HEAP[$s_addr + 5796 | 0] | 0;
      HEAP[$arrayidx131] = 0;
      var $last_lit132 = $s_addr + 5792 | 0;
      var $116 = HEAP[$last_lit132];
      var $inc133 = $116 + 1 | 0;
      HEAP[$last_lit132] = $inc133;
      var $arrayidx135 = HEAP[$s_addr + 5784 | 0] + $116 | 0;
      HEAP[$arrayidx135] = $cc;
      var $freq140 = (($cc & 255) << 2) + $s_addr + 148 | 0;
      var $inc141 = HEAP[$freq140] + 1 & 65535;
      HEAP[$freq140] = $inc141;
      $bflush = (HEAP[$s_addr + 5792 | 0] | 0) == (HEAP[$s_addr + 5788 | 0] - 1 | 0) & 1;
      var $lookahead147 = $s_addr + 116 | 0;
      var $dec148 = HEAP[$lookahead147] - 1 | 0;
      HEAP[$lookahead147] = $dec148;
      var $strstart149 = $s_addr + 108 | 0;
      var $inc150 = HEAP[$strstart149] + 1 | 0;
      HEAP[$strstart149] = $inc150;
    }
    if (($bflush | 0) == 0) {
      continue;
    }
    if ((HEAP[$s_addr + 92 | 0] | 0) >= 0) {
      var $cond161 = HEAP[$s_addr + 56 | 0] + HEAP[$s_addr + 92 | 0] | 0;
    } else {
      var $cond161 = 0;
    }
    var $cond161;
    var $sub164 = HEAP[$s_addr + 108 | 0] - HEAP[$s_addr + 92 | 0] | 0;
    __tr_flush_block($s_addr, $cond161, $sub164, 0);
    var $143 = HEAP[$s_addr + 108 | 0];
    HEAP[$s_addr + 92 | 0] = $143;
    var $146 = HEAP[$s_addr | 0];
    _flush_pending($146);
    if ((HEAP[HEAP[$s_addr | 0] + 16 | 0] | 0) != 0) {
      continue;
    }
    $retval = 0;
    break;
  }
  return $retval;
  return null;
}

_deflate_rle["X"] = 1;

function _fill_window($s) {
  var $s_addr;
  var $n;
  var $m;
  var $p;
  var $more;
  var $wsize;
  var $curr;
  var $init;
  $s_addr = $s;
  $wsize = HEAP[$s_addr + 44 | 0];
  while (1) {
    $more = -HEAP[$s_addr + 116 | 0] + HEAP[$s_addr + 60 | 0] + -HEAP[$s_addr + 108 | 0] | 0;
    if (HEAP[$s_addr + 108 | 0] >>> 0 >= ($wsize - 262 + HEAP[$s_addr + 44 | 0] | 0) >>> 0) {
      var $14 = HEAP[$s_addr + 56 | 0];
      var $add_ptr = HEAP[$s_addr + 56 | 0] + $wsize | 0;
      var $18 = $wsize;
      for (var $$src = $add_ptr, $$dest = $14, $$stop = $$src + $18; $$src < $$stop; $$src++, $$dest++) {
        HEAP[$$dest] = HEAP[$$src];
      }
      var $match_start = $s_addr + 112 | 0;
      var $sub6 = HEAP[$match_start] - $wsize | 0;
      HEAP[$match_start] = $sub6;
      var $strstart7 = $s_addr + 108 | 0;
      var $sub8 = HEAP[$strstart7] - $wsize | 0;
      HEAP[$strstart7] = $sub8;
      var $block_start = $s_addr + 92 | 0;
      var $sub9 = HEAP[$block_start] - $wsize | 0;
      HEAP[$block_start] = $sub9;
      $n = HEAP[$s_addr + 76 | 0];
      $p = ($n << 1) + HEAP[$s_addr + 68 | 0] | 0;
      while (1) {
        var $incdec_ptr = $p - 2 | 0;
        $p = $incdec_ptr;
        $m = HEAP[$incdec_ptr] & 65535;
        if ($m >>> 0 >= $wsize >>> 0) {
          var $cond = $m - $wsize | 0;
        } else {
          var $cond = 0;
        }
        var $cond;
        HEAP[$p] = $cond & 65535;
        var $dec = $n - 1 | 0;
        $n = $dec;
        if (($dec | 0) == 0) {
          break;
        }
      }
      $n = $wsize;
      $p = ($n << 1) + HEAP[$s_addr + 64 | 0] | 0;
      while (1) {
        var $incdec_ptr17 = $p - 2 | 0;
        $p = $incdec_ptr17;
        $m = HEAP[$incdec_ptr17] & 65535;
        if ($m >>> 0 >= $wsize >>> 0) {
          var $cond25 = $m - $wsize | 0;
        } else {
          var $cond25 = 0;
        }
        var $cond25;
        HEAP[$p] = $cond25 & 65535;
        var $dec28 = $n - 1 | 0;
        $n = $dec28;
        if (($dec28 | 0) == 0) {
          break;
        }
      }
      var $add31 = $more + $wsize | 0;
      $more = $add31;
    }
    if ((HEAP[HEAP[$s_addr | 0] + 4 | 0] | 0) == 0) {
      break;
    }
    var $59 = HEAP[$s_addr | 0];
    var $add_ptr41 = HEAP[$s_addr + 56 | 0] + HEAP[$s_addr + 108 | 0] + HEAP[$s_addr + 116 | 0] | 0;
    var $call = _read_buf($59, $add_ptr41, $more);
    $n = $call;
    var $lookahead42 = $s_addr + 116 | 0;
    var $add43 = HEAP[$lookahead42] + $n | 0;
    HEAP[$lookahead42] = $add43;
    if (HEAP[$s_addr + 116 | 0] >>> 0 >= 3) {
      var $conv51 = HEAP[HEAP[$s_addr + 56 | 0] + HEAP[$s_addr + 108 | 0] | 0] & 255;
      HEAP[$s_addr + 72 | 0] = $conv51;
      var $and = (HEAP[HEAP[$s_addr + 56 | 0] + HEAP[$s_addr + 108 | 0] + 1 | 0] & 255 ^ HEAP[$s_addr + 72 | 0] << HEAP[$s_addr + 88 | 0]) & HEAP[$s_addr + 84 | 0];
      HEAP[$s_addr + 72 | 0] = $and;
    }
    if (HEAP[$s_addr + 116 | 0] >>> 0 < 262) {
      if ((HEAP[HEAP[$s_addr | 0] + 4 | 0] | 0) != 0) {
        continue;
      }
    }
    if (HEAP[$s_addr + 5824 | 0] >>> 0 >= HEAP[$s_addr + 60 | 0] >>> 0) {
      break;
    }
    $curr = HEAP[$s_addr + 116 | 0] + HEAP[$s_addr + 108 | 0] | 0;
    var $106 = $s_addr;
    if (HEAP[$s_addr + 5824 | 0] >>> 0 < $curr >>> 0) {
      $init = HEAP[$106 + 60 | 0] - $curr | 0;
      if ($init >>> 0 > 258) {
        $init = 258;
      }
      var $add_ptr87 = HEAP[$s_addr + 56 | 0] + $curr | 0;
      var $113 = $init;
      for (var $$dest = $add_ptr87, $$stop = $$dest + $113; $$dest < $$stop; $$dest++) {
        HEAP[$$dest] = 0;
      }
      HEAP[$s_addr + 5824 | 0] = $init + $curr | 0;
      break;
    }
    if (HEAP[$106 + 5824 | 0] >>> 0 >= ($curr + 258 | 0) >>> 0) {
      break;
    }
    $init = $curr + -HEAP[$s_addr + 5824 | 0] + 258 | 0;
    if ($init >>> 0 > (HEAP[$s_addr + 60 | 0] - HEAP[$s_addr + 5824 | 0] | 0) >>> 0) {
      $init = HEAP[$s_addr + 60 | 0] - HEAP[$s_addr + 5824 | 0] | 0;
    }
    var $add_ptr110 = HEAP[$s_addr + 56 | 0] + HEAP[$s_addr + 5824 | 0] | 0;
    var $135 = $init;
    for (var $$dest = $add_ptr110, $$stop = $$dest + $135; $$dest < $$stop; $$dest++) {
      HEAP[$$dest] = 0;
    }
    var $high_water111 = $s_addr + 5824 | 0;
    var $add112 = HEAP[$high_water111] + $init | 0;
    HEAP[$high_water111] = $add112;
    break;
  }
  return;
  return;
}

_fill_window["X"] = 1;

function _read_buf($strm, $buf, $size) {
  var $retval;
  var $strm_addr;
  var $buf_addr;
  var $size_addr;
  var $len;
  $strm_addr = $strm;
  $buf_addr = $buf;
  $size_addr = $size;
  $len = HEAP[$strm_addr + 4 | 0];
  var $2 = $len;
  if ($2 >>> 0 > $size_addr >>> 0) {
    var $4 = $size_addr;
    $len = $4;
    var $5 = $4;
  } else {
    var $5 = $2;
  }
  var $5;
  if (($5 | 0) == 0) {
    $retval = 0;
  } else {
    var $avail_in4 = $strm_addr + 4 | 0;
    var $sub = HEAP[$avail_in4] - $len | 0;
    HEAP[$avail_in4] = $sub;
    var $cmp5 = (HEAP[HEAP[$strm_addr + 28 | 0] + 24 | 0] | 0) == 1;
    var $12 = $strm_addr;
    do {
      if ($cmp5) {
        var $13 = HEAP[$12 + 48 | 0];
        var $15 = HEAP[$strm_addr | 0];
        var $call = _adler32($13, $15, $len);
        HEAP[$strm_addr + 48 | 0] = $call;
      } else {
        if ((HEAP[HEAP[$12 + 28 | 0] + 24 | 0] | 0) != 2) {
          break;
        }
        var $21 = HEAP[$strm_addr + 48 | 0];
        var $23 = HEAP[$strm_addr | 0];
        var $call14 = _crc32($21, $23, $len);
        HEAP[$strm_addr + 48 | 0] = $call14;
      }
    } while (0);
    var $26 = $buf_addr;
    var $28 = HEAP[$strm_addr | 0];
    var $29 = $len;
    for (var $$src = $28, $$dest = $26, $$stop = $$src + $29; $$src < $$stop; $$src++, $$dest++) {
      HEAP[$$dest] = HEAP[$$src];
    }
    var $next_in19 = $strm_addr | 0;
    var $add_ptr = HEAP[$next_in19] + $len | 0;
    HEAP[$next_in19] = $add_ptr;
    var $total_in = $strm_addr + 8 | 0;
    var $add = HEAP[$total_in] + $len | 0;
    HEAP[$total_in] = $add;
    $retval = $len;
  }
  return $retval;
  return null;
}

_read_buf["X"] = 1;

function _deflate_stored($s, $flush) {
  var __label__;
  var $retval;
  var $s_addr;
  var $flush_addr;
  var $max_block_size;
  var $max_start;
  $s_addr = $s;
  $flush_addr = $flush;
  $max_block_size = 65535;
  if ($max_block_size >>> 0 > (HEAP[$s_addr + 12 | 0] - 5 | 0) >>> 0) {
    $max_block_size = HEAP[$s_addr + 12 | 0] - 5 | 0;
  } else {
    __label__ = 2;
  }
  $for_cond$54 : while (1) {
    var $cmp3 = HEAP[$s_addr + 116 | 0] >>> 0 <= 1;
    do {
      if ($cmp3) {
        _fill_window($s_addr);
        var $cmp6 = (HEAP[$s_addr + 116 | 0] | 0) == 0;
        do {
          if ($cmp6) {
            if (($flush_addr | 0) != 0) {
              break;
            }
            $retval = 0;
            break $for_cond$54;
          }
        } while (0);
        if ((HEAP[$s_addr + 116 | 0] | 0) != 0) {
          break;
        }
        if ((HEAP[$s_addr + 92 | 0] | 0) >= 0) {
          var $cond75 = HEAP[$s_addr + 56 | 0] + HEAP[$s_addr + 92 | 0] | 0;
        } else {
          var $cond75 = 0;
        }
        var $cond75;
        var $sub78 = HEAP[$s_addr + 108 | 0] - HEAP[$s_addr + 92 | 0] | 0;
        __tr_flush_block($s_addr, $cond75, $sub78, ($flush_addr | 0) == 4 & 1);
        var $89 = HEAP[$s_addr + 108 | 0];
        HEAP[$s_addr + 92 | 0] = $89;
        var $92 = HEAP[$s_addr | 0];
        _flush_pending($92);
        var $cmp88 = ($flush_addr | 0) == 4;
        if ((HEAP[HEAP[$s_addr | 0] + 16 | 0] | 0) == 0) {
          var $cond90 = $cmp88 ? 2 : 0;
          $retval = $cond90;
          break $for_cond$54;
        }
        var $cond94 = $cmp88 ? 3 : 1;
        $retval = $cond94;
        break $for_cond$54;
      }
    } while (0);
    var $strstart = $s_addr + 108 | 0;
    var $add = HEAP[$strstart] + HEAP[$s_addr + 116 | 0] | 0;
    HEAP[$strstart] = $add;
    HEAP[$s_addr + 116 | 0] = 0;
    $max_start = $max_block_size + HEAP[$s_addr + 92 | 0] | 0;
    var $cmp19 = (HEAP[$s_addr + 108 | 0] | 0) == 0;
    do {
      if ($cmp19) {
        __label__ = 9;
      } else {
        if (HEAP[$s_addr + 108 | 0] >>> 0 >= $max_start >>> 0) {
          __label__ = 9;
          break;
        }
        __label__ = 13;
        break;
      }
    } while (0);
    do {
      if (__label__ == 9) {
        var $sub24 = HEAP[$s_addr + 108 | 0] - $max_start | 0;
        HEAP[$s_addr + 116 | 0] = $sub24;
        HEAP[$s_addr + 108 | 0] = $max_start;
        if ((HEAP[$s_addr + 92 | 0] | 0) >= 0) {
          var $cond = HEAP[$s_addr + 56 | 0] + HEAP[$s_addr + 92 | 0] | 0;
        } else {
          var $cond = 0;
        }
        var $cond;
        var $sub32 = HEAP[$s_addr + 108 | 0] - HEAP[$s_addr + 92 | 0] | 0;
        __tr_flush_block($s_addr, $cond, $sub32, 0);
        var $44 = HEAP[$s_addr + 108 | 0];
        HEAP[$s_addr + 92 | 0] = $44;
        var $47 = HEAP[$s_addr | 0];
        _flush_pending($47);
        if ((HEAP[HEAP[$s_addr | 0] + 16 | 0] | 0) != 0) {
          break;
        }
        $retval = 0;
        break $for_cond$54;
      }
    } while (0);
    if (!((HEAP[$s_addr + 108 | 0] - HEAP[$s_addr + 92 | 0] | 0) >>> 0 >= (HEAP[$s_addr + 44 | 0] - 262 | 0) >>> 0)) {
      continue;
    }
    if ((HEAP[$s_addr + 92 | 0] | 0) >= 0) {
      var $cond54 = HEAP[$s_addr + 56 | 0] + HEAP[$s_addr + 92 | 0] | 0;
    } else {
      var $cond54 = 0;
    }
    var $cond54;
    var $sub57 = HEAP[$s_addr + 108 | 0] - HEAP[$s_addr + 92 | 0] | 0;
    __tr_flush_block($s_addr, $cond54, $sub57, 0);
    var $69 = HEAP[$s_addr + 108 | 0];
    HEAP[$s_addr + 92 | 0] = $69;
    var $72 = HEAP[$s_addr | 0];
    _flush_pending($72);
    if ((HEAP[HEAP[$s_addr | 0] + 16 | 0] | 0) != 0) {
      continue;
    }
    $retval = 0;
    break;
  }
  return $retval;
  return null;
}

_deflate_stored["X"] = 1;

function _deflate_fast($s, $flush) {
  var $retval;
  var $s_addr;
  var $flush_addr;
  var $hash_head;
  var $bflush;
  var $len;
  var $dist;
  var $cc;
  $s_addr = $s;
  $flush_addr = $flush;
  $for_cond$2 : while (1) {
    var $cmp = HEAP[$s_addr + 116 | 0] >>> 0 < 262;
    do {
      if ($cmp) {
        _fill_window($s_addr);
        var $cmp2 = HEAP[$s_addr + 116 | 0] >>> 0 < 262;
        do {
          if ($cmp2) {
            if (($flush_addr | 0) != 0) {
              break;
            }
            $retval = 0;
            break $for_cond$2;
          }
        } while (0);
        if ((HEAP[$s_addr + 116 | 0] | 0) != 0) {
          break;
        }
        if ((HEAP[$s_addr + 92 | 0] | 0) >= 0) {
          var $cond198 = HEAP[$s_addr + 56 | 0] + HEAP[$s_addr + 92 | 0] | 0;
        } else {
          var $cond198 = 0;
        }
        var $cond198;
        var $sub201 = HEAP[$s_addr + 108 | 0] - HEAP[$s_addr + 92 | 0] | 0;
        __tr_flush_block($s_addr, $cond198, $sub201, ($flush_addr | 0) == 4 & 1);
        var $207 = HEAP[$s_addr + 108 | 0];
        HEAP[$s_addr + 92 | 0] = $207;
        var $210 = HEAP[$s_addr | 0];
        _flush_pending($210);
        var $cmp212 = ($flush_addr | 0) == 4;
        if ((HEAP[HEAP[$s_addr | 0] + 16 | 0] | 0) == 0) {
          var $cond214 = $cmp212 ? 2 : 0;
          $retval = $cond214;
          break $for_cond$2;
        }
        var $cond218 = $cmp212 ? 3 : 1;
        $retval = $cond218;
        break $for_cond$2;
      }
    } while (0);
    $hash_head = 0;
    var $cmp11 = HEAP[$s_addr + 116 | 0] >>> 0 >= 3;
    do {
      if ($cmp11) {
        var $and = (HEAP[HEAP[$s_addr + 56 | 0] + HEAP[$s_addr + 108 | 0] + 2 | 0] & 255 ^ HEAP[$s_addr + 72 | 0] << HEAP[$s_addr + 88 | 0]) & HEAP[$s_addr + 84 | 0];
        HEAP[$s_addr + 72 | 0] = $and;
        var $26 = HEAP[(HEAP[$s_addr + 72 | 0] << 1) + HEAP[$s_addr + 68 | 0] | 0];
        var $arrayidx18 = ((HEAP[$s_addr + 52 | 0] & HEAP[$s_addr + 108 | 0]) << 1) + HEAP[$s_addr + 64 | 0] | 0;
        HEAP[$arrayidx18] = $26;
        $hash_head = $26 & 65535;
        var $conv21 = HEAP[$s_addr + 108 | 0] & 65535;
        var $arrayidx24 = (HEAP[$s_addr + 72 | 0] << 1) + HEAP[$s_addr + 68 | 0] | 0;
        HEAP[$arrayidx24] = $conv21;
        if (($hash_head | 0) == 0) {
          break;
        }
        if (!((HEAP[$s_addr + 108 | 0] - $hash_head | 0) >>> 0 <= (HEAP[$s_addr + 44 | 0] - 262 | 0) >>> 0)) {
          break;
        }
        var $call = _longest_match($s_addr, $hash_head);
        HEAP[$s_addr + 96 | 0] = $call;
      }
    } while (0);
    var $cmp36 = HEAP[$s_addr + 96 | 0] >>> 0 >= 3;
    var $49 = $s_addr;
    $if_then38$$if_else141$23 : do {
      if ($cmp36) {
        $len = HEAP[$49 + 96 | 0] - 3 & 255;
        $dist = HEAP[$s_addr + 108 | 0] - HEAP[$s_addr + 112 | 0] & 65535;
        var $arrayidx45 = (HEAP[$s_addr + 5792 | 0] << 1) + HEAP[$s_addr + 5796 | 0] | 0;
        HEAP[$arrayidx45] = $dist;
        var $last_lit46 = $s_addr + 5792 | 0;
        var $62 = HEAP[$last_lit46];
        var $inc = $62 + 1 | 0;
        HEAP[$last_lit46] = $inc;
        var $arrayidx47 = HEAP[$s_addr + 5784 | 0] + $62 | 0;
        HEAP[$arrayidx47] = $len;
        var $dec = $dist - 1 & 65535;
        $dist = $dec;
        var $arrayidx48 = STRING_TABLE.__length_code + ($len & 255) | 0;
        var $freq = ((HEAP[$arrayidx48] & 255) + 257 << 2) + $s_addr + 148 | 0;
        var $inc53 = HEAP[$freq] + 1 & 65535;
        HEAP[$freq] = $inc53;
        var $idxprom57 = $dist & 65535;
        if (($dist & 65535 | 0) < 256) {
          var $arrayidx58 = STRING_TABLE.__dist_code + $idxprom57 | 0;
          var $cond = HEAP[$arrayidx58] & 255;
        } else {
          var $arrayidx62 = ($idxprom57 >> 7) + STRING_TABLE.__dist_code + 256 | 0;
          var $cond = HEAP[$arrayidx62] & 255;
        }
        var $cond;
        var $freq66 = ($cond << 2) + $s_addr + 2440 | 0;
        var $inc67 = HEAP[$freq66] + 1 & 65535;
        HEAP[$freq66] = $inc67;
        $bflush = (HEAP[$s_addr + 5792 | 0] | 0) == (HEAP[$s_addr + 5788 | 0] - 1 | 0) & 1;
        var $lookahead73 = $s_addr + 116 | 0;
        var $sub74 = HEAP[$lookahead73] - HEAP[$s_addr + 96 | 0] | 0;
        HEAP[$lookahead73] = $sub74;
        var $cmp76 = HEAP[$s_addr + 96 | 0] >>> 0 <= HEAP[$s_addr + 128 | 0] >>> 0;
        do {
          if ($cmp76) {
            if (!(HEAP[$s_addr + 116 | 0] >>> 0 >= 3)) {
              break;
            }
            var $match_length83 = $s_addr + 96 | 0;
            var $dec84 = HEAP[$match_length83] - 1 | 0;
            HEAP[$match_length83] = $dec84;
            while (1) {
              var $strstart85 = $s_addr + 108 | 0;
              var $inc86 = HEAP[$strstart85] + 1 | 0;
              HEAP[$strstart85] = $inc86;
              var $and97 = (HEAP[HEAP[$s_addr + 56 | 0] + HEAP[$s_addr + 108 | 0] + 2 | 0] & 255 ^ HEAP[$s_addr + 72 | 0] << HEAP[$s_addr + 88 | 0]) & HEAP[$s_addr + 84 | 0];
              HEAP[$s_addr + 72 | 0] = $and97;
              var $110 = HEAP[(HEAP[$s_addr + 72 | 0] << 1) + HEAP[$s_addr + 68 | 0] | 0];
              var $arrayidx106 = ((HEAP[$s_addr + 52 | 0] & HEAP[$s_addr + 108 | 0]) << 1) + HEAP[$s_addr + 64 | 0] | 0;
              HEAP[$arrayidx106] = $110;
              $hash_head = $110 & 65535;
              var $conv109 = HEAP[$s_addr + 108 | 0] & 65535;
              var $arrayidx112 = (HEAP[$s_addr + 72 | 0] << 1) + HEAP[$s_addr + 68 | 0] | 0;
              HEAP[$arrayidx112] = $conv109;
              var $match_length113 = $s_addr + 96 | 0;
              var $dec114 = HEAP[$match_length113] - 1 | 0;
              HEAP[$match_length113] = $dec114;
              if (($dec114 | 0) == 0) {
                break;
              }
            }
            var $strstart117 = $s_addr + 108 | 0;
            var $inc118 = HEAP[$strstart117] + 1 | 0;
            HEAP[$strstart117] = $inc118;
            break $if_then38$$if_else141$23;
          }
        } while (0);
        var $strstart120 = $s_addr + 108 | 0;
        var $add121 = HEAP[$strstart120] + HEAP[$s_addr + 96 | 0] | 0;
        HEAP[$strstart120] = $add121;
        HEAP[$s_addr + 96 | 0] = 0;
        var $conv126 = HEAP[HEAP[$s_addr + 56 | 0] + HEAP[$s_addr + 108 | 0] | 0] & 255;
        HEAP[$s_addr + 72 | 0] = $conv126;
        var $and138 = (HEAP[HEAP[$s_addr + 56 | 0] + HEAP[$s_addr + 108 | 0] + 1 | 0] & 255 ^ HEAP[$s_addr + 72 | 0] << HEAP[$s_addr + 88 | 0]) & HEAP[$s_addr + 84 | 0];
        HEAP[$s_addr + 72 | 0] = $and138;
      } else {
        $cc = HEAP[HEAP[$s_addr + 56 | 0] + HEAP[$49 + 108 | 0] | 0];
        var $arrayidx147 = (HEAP[$s_addr + 5792 | 0] << 1) + HEAP[$s_addr + 5796 | 0] | 0;
        HEAP[$arrayidx147] = 0;
        var $last_lit148 = $s_addr + 5792 | 0;
        var $160 = HEAP[$last_lit148];
        var $inc149 = $160 + 1 | 0;
        HEAP[$last_lit148] = $inc149;
        var $arrayidx151 = HEAP[$s_addr + 5784 | 0] + $160 | 0;
        HEAP[$arrayidx151] = $cc;
        var $freq156 = (($cc & 255) << 2) + $s_addr + 148 | 0;
        var $inc157 = HEAP[$freq156] + 1 & 65535;
        HEAP[$freq156] = $inc157;
        $bflush = (HEAP[$s_addr + 5792 | 0] | 0) == (HEAP[$s_addr + 5788 | 0] - 1 | 0) & 1;
        var $lookahead163 = $s_addr + 116 | 0;
        var $dec164 = HEAP[$lookahead163] - 1 | 0;
        HEAP[$lookahead163] = $dec164;
        var $strstart165 = $s_addr + 108 | 0;
        var $inc166 = HEAP[$strstart165] + 1 | 0;
        HEAP[$strstart165] = $inc166;
      }
    } while (0);
    if (($bflush | 0) == 0) {
      continue;
    }
    if ((HEAP[$s_addr + 92 | 0] | 0) >= 0) {
      var $cond177 = HEAP[$s_addr + 56 | 0] + HEAP[$s_addr + 92 | 0] | 0;
    } else {
      var $cond177 = 0;
    }
    var $cond177;
    var $sub180 = HEAP[$s_addr + 108 | 0] - HEAP[$s_addr + 92 | 0] | 0;
    __tr_flush_block($s_addr, $cond177, $sub180, 0);
    var $187 = HEAP[$s_addr + 108 | 0];
    HEAP[$s_addr + 92 | 0] = $187;
    var $190 = HEAP[$s_addr | 0];
    _flush_pending($190);
    if ((HEAP[HEAP[$s_addr | 0] + 16 | 0] | 0) != 0) {
      continue;
    }
    $retval = 0;
    break;
  }
  return $retval;
  return null;
}

_deflate_fast["X"] = 1;

function _deflate_slow($s, $flush) {
  var $retval;
  var $s_addr;
  var $flush_addr;
  var $hash_head;
  var $bflush;
  var $max_insert;
  var $len;
  var $dist;
  var $cc;
  var $cc238;
  $s_addr = $s;
  $flush_addr = $flush;
  $for_cond$2 : while (1) {
    var $cmp = HEAP[$s_addr + 116 | 0] >>> 0 < 262;
    do {
      if ($cmp) {
        _fill_window($s_addr);
        var $cmp2 = HEAP[$s_addr + 116 | 0] >>> 0 < 262;
        do {
          if ($cmp2) {
            if (($flush_addr | 0) != 0) {
              break;
            }
            $retval = 0;
            break $for_cond$2;
          }
        } while (0);
        if ((HEAP[$s_addr + 116 | 0] | 0) != 0) {
          break;
        }
        if ((HEAP[$s_addr + 104 | 0] | 0) != 0) {
          $cc238 = HEAP[HEAP[$s_addr + 56 | 0] + (HEAP[$s_addr + 108 | 0] - 1) | 0];
          var $arrayidx245 = (HEAP[$s_addr + 5792 | 0] << 1) + HEAP[$s_addr + 5796 | 0] | 0;
          HEAP[$arrayidx245] = 0;
          var $last_lit246 = $s_addr + 5792 | 0;
          var $239 = HEAP[$last_lit246];
          var $inc247 = $239 + 1 | 0;
          HEAP[$last_lit246] = $inc247;
          var $arrayidx249 = HEAP[$s_addr + 5784 | 0] + $239 | 0;
          HEAP[$arrayidx249] = $cc238;
          var $freq254 = (($cc238 & 255) << 2) + $s_addr + 148 | 0;
          var $inc255 = HEAP[$freq254] + 1 & 65535;
          HEAP[$freq254] = $inc255;
          $bflush = (HEAP[$s_addr + 5792 | 0] | 0) == (HEAP[$s_addr + 5788 | 0] - 1 | 0) & 1;
          HEAP[$s_addr + 104 | 0] = 0;
        }
        if ((HEAP[$s_addr + 92 | 0] | 0) >= 0) {
          var $cond272 = HEAP[$s_addr + 56 | 0] + HEAP[$s_addr + 92 | 0] | 0;
        } else {
          var $cond272 = 0;
        }
        var $cond272;
        var $sub275 = HEAP[$s_addr + 108 | 0] - HEAP[$s_addr + 92 | 0] | 0;
        __tr_flush_block($s_addr, $cond272, $sub275, ($flush_addr | 0) == 4 & 1);
        var $263 = HEAP[$s_addr + 108 | 0];
        HEAP[$s_addr + 92 | 0] = $263;
        var $266 = HEAP[$s_addr | 0];
        _flush_pending($266);
        var $cmp286 = ($flush_addr | 0) == 4;
        if ((HEAP[HEAP[$s_addr | 0] + 16 | 0] | 0) == 0) {
          var $cond288 = $cmp286 ? 2 : 0;
          $retval = $cond288;
          break $for_cond$2;
        }
        var $cond292 = $cmp286 ? 3 : 1;
        $retval = $cond292;
        break $for_cond$2;
      }
    } while (0);
    $hash_head = 0;
    if (HEAP[$s_addr + 116 | 0] >>> 0 >= 3) {
      var $and = (HEAP[HEAP[$s_addr + 56 | 0] + HEAP[$s_addr + 108 | 0] + 2 | 0] & 255 ^ HEAP[$s_addr + 72 | 0] << HEAP[$s_addr + 88 | 0]) & HEAP[$s_addr + 84 | 0];
      HEAP[$s_addr + 72 | 0] = $and;
      var $26 = HEAP[(HEAP[$s_addr + 72 | 0] << 1) + HEAP[$s_addr + 68 | 0] | 0];
      var $arrayidx18 = ((HEAP[$s_addr + 52 | 0] & HEAP[$s_addr + 108 | 0]) << 1) + HEAP[$s_addr + 64 | 0] | 0;
      HEAP[$arrayidx18] = $26;
      $hash_head = $26 & 65535;
      var $conv21 = HEAP[$s_addr + 108 | 0] & 65535;
      var $arrayidx24 = (HEAP[$s_addr + 72 | 0] << 1) + HEAP[$s_addr + 68 | 0] | 0;
      HEAP[$arrayidx24] = $conv21;
    }
    var $40 = HEAP[$s_addr + 96 | 0];
    HEAP[$s_addr + 120 | 0] = $40;
    var $43 = HEAP[$s_addr + 112 | 0];
    HEAP[$s_addr + 100 | 0] = $43;
    HEAP[$s_addr + 96 | 0] = 2;
    var $cmp27 = ($hash_head | 0) != 0;
    do {
      if ($cmp27) {
        if (HEAP[$s_addr + 120 | 0] >>> 0 >= HEAP[$s_addr + 128 | 0] >>> 0) {
          break;
        }
        if (!((HEAP[$s_addr + 108 | 0] - $hash_head | 0) >>> 0 <= (HEAP[$s_addr + 44 | 0] - 262 | 0) >>> 0)) {
          break;
        }
        var $call = _longest_match($s_addr, $hash_head);
        HEAP[$s_addr + 96 | 0] = $call;
        if (!(HEAP[$s_addr + 96 | 0] >>> 0 <= 5)) {
          break;
        }
        if ((HEAP[$s_addr + 136 | 0] | 0) != 1) {
          if ((HEAP[$s_addr + 96 | 0] | 0) != 3) {
            break;
          }
          if ((HEAP[$s_addr + 108 | 0] - HEAP[$s_addr + 112 | 0] | 0) >>> 0 <= 4096) {
            break;
          }
        }
        HEAP[$s_addr + 96 | 0] = 2;
      }
    } while (0);
    var $cmp60 = HEAP[$s_addr + 120 | 0] >>> 0 >= 3;
    do {
      if ($cmp60) {
        if (!(HEAP[$s_addr + 96 | 0] >>> 0 <= HEAP[$s_addr + 120 | 0] >>> 0)) {
          break;
        }
        $max_insert = HEAP[$s_addr + 108 | 0] - 3 + HEAP[$s_addr + 116 | 0] | 0;
        $len = HEAP[$s_addr + 120 | 0] - 3 & 255;
        $dist = HEAP[$s_addr + 108 | 0] - 1 + -HEAP[$s_addr + 100 | 0] & 65535;
        var $arrayidx80 = (HEAP[$s_addr + 5792 | 0] << 1) + HEAP[$s_addr + 5796 | 0] | 0;
        HEAP[$arrayidx80] = $dist;
        var $last_lit81 = $s_addr + 5792 | 0;
        var $93 = HEAP[$last_lit81];
        var $inc = $93 + 1 | 0;
        HEAP[$last_lit81] = $inc;
        var $arrayidx82 = HEAP[$s_addr + 5784 | 0] + $93 | 0;
        HEAP[$arrayidx82] = $len;
        var $dec = $dist - 1 & 65535;
        $dist = $dec;
        var $arrayidx83 = STRING_TABLE.__length_code + ($len & 255) | 0;
        var $freq = ((HEAP[$arrayidx83] & 255) + 257 << 2) + $s_addr + 148 | 0;
        var $inc88 = HEAP[$freq] + 1 & 65535;
        HEAP[$freq] = $inc88;
        var $idxprom92 = $dist & 65535;
        if (($dist & 65535 | 0) < 256) {
          var $arrayidx93 = STRING_TABLE.__dist_code + $idxprom92 | 0;
          var $cond = HEAP[$arrayidx93] & 255;
        } else {
          var $arrayidx97 = ($idxprom92 >> 7) + STRING_TABLE.__dist_code + 256 | 0;
          var $cond = HEAP[$arrayidx97] & 255;
        }
        var $cond;
        var $freq101 = ($cond << 2) + $s_addr + 2440 | 0;
        var $inc102 = HEAP[$freq101] + 1 & 65535;
        HEAP[$freq101] = $inc102;
        $bflush = (HEAP[$s_addr + 5792 | 0] | 0) == (HEAP[$s_addr + 5788 | 0] - 1 | 0) & 1;
        var $lookahead109 = $s_addr + 116 | 0;
        var $sub110 = -HEAP[$s_addr + 120 | 0] + HEAP[$lookahead109] + 1 | 0;
        HEAP[$lookahead109] = $sub110;
        var $prev_length111 = $s_addr + 120 | 0;
        var $sub112 = HEAP[$prev_length111] - 2 | 0;
        HEAP[$prev_length111] = $sub112;
        while (1) {
          var $strstart113 = $s_addr + 108 | 0;
          var $inc114 = HEAP[$strstart113] + 1 | 0;
          HEAP[$strstart113] = $inc114;
          if ($inc114 >>> 0 <= $max_insert >>> 0) {
            var $and128 = (HEAP[HEAP[$s_addr + 56 | 0] + HEAP[$s_addr + 108 | 0] + 2 | 0] & 255 ^ HEAP[$s_addr + 72 | 0] << HEAP[$s_addr + 88 | 0]) & HEAP[$s_addr + 84 | 0];
            HEAP[$s_addr + 72 | 0] = $and128;
            var $136 = HEAP[(HEAP[$s_addr + 72 | 0] << 1) + HEAP[$s_addr + 68 | 0] | 0];
            var $arrayidx137 = ((HEAP[$s_addr + 52 | 0] & HEAP[$s_addr + 108 | 0]) << 1) + HEAP[$s_addr + 64 | 0] | 0;
            HEAP[$arrayidx137] = $136;
            $hash_head = $136 & 65535;
            var $conv140 = HEAP[$s_addr + 108 | 0] & 65535;
            var $arrayidx143 = (HEAP[$s_addr + 72 | 0] << 1) + HEAP[$s_addr + 68 | 0] | 0;
            HEAP[$arrayidx143] = $conv140;
          }
          var $prev_length145 = $s_addr + 120 | 0;
          var $dec146 = HEAP[$prev_length145] - 1 | 0;
          HEAP[$prev_length145] = $dec146;
          if (($dec146 | 0) == 0) {
            break;
          }
        }
        HEAP[$s_addr + 104 | 0] = 0;
        HEAP[$s_addr + 96 | 0] = 2;
        var $strstart150 = $s_addr + 108 | 0;
        var $inc151 = HEAP[$strstart150] + 1 | 0;
        HEAP[$strstart150] = $inc151;
        if (($bflush | 0) == 0) {
          continue $for_cond$2;
        }
        if ((HEAP[$s_addr + 92 | 0] | 0) >= 0) {
          var $cond161 = HEAP[$s_addr + 56 | 0] + HEAP[$s_addr + 92 | 0] | 0;
        } else {
          var $cond161 = 0;
        }
        var $cond161;
        var $sub164 = HEAP[$s_addr + 108 | 0] - HEAP[$s_addr + 92 | 0] | 0;
        __tr_flush_block($s_addr, $cond161, $sub164, 0);
        var $168 = HEAP[$s_addr + 108 | 0];
        HEAP[$s_addr + 92 | 0] = $168;
        var $171 = HEAP[$s_addr | 0];
        _flush_pending($171);
        if ((HEAP[HEAP[$s_addr | 0] + 16 | 0] | 0) != 0) {
          continue $for_cond$2;
        }
        $retval = 0;
        break $for_cond$2;
      }
    } while (0);
    var $177 = $s_addr;
    if ((HEAP[$s_addr + 104 | 0] | 0) != 0) {
      $cc = HEAP[HEAP[$s_addr + 56 | 0] + (HEAP[$177 + 108 | 0] - 1) | 0];
      var $arrayidx182 = (HEAP[$s_addr + 5792 | 0] << 1) + HEAP[$s_addr + 5796 | 0] | 0;
      HEAP[$arrayidx182] = 0;
      var $last_lit183 = $s_addr + 5792 | 0;
      var $188 = HEAP[$last_lit183];
      var $inc184 = $188 + 1 | 0;
      HEAP[$last_lit183] = $inc184;
      var $arrayidx186 = HEAP[$s_addr + 5784 | 0] + $188 | 0;
      HEAP[$arrayidx186] = $cc;
      var $freq191 = (($cc & 255) << 2) + $s_addr + 148 | 0;
      var $inc192 = HEAP[$freq191] + 1 & 65535;
      HEAP[$freq191] = $inc192;
      $bflush = (HEAP[$s_addr + 5792 | 0] | 0) == (HEAP[$s_addr + 5788 | 0] - 1 | 0) & 1;
      if (($bflush | 0) != 0) {
        if ((HEAP[$s_addr + 92 | 0] | 0) >= 0) {
          var $cond209 = HEAP[$s_addr + 56 | 0] + HEAP[$s_addr + 92 | 0] | 0;
        } else {
          var $cond209 = 0;
        }
        var $cond209;
        var $sub212 = HEAP[$s_addr + 108 | 0] - HEAP[$s_addr + 92 | 0] | 0;
        __tr_flush_block($s_addr, $cond209, $sub212, 0);
        var $211 = HEAP[$s_addr + 108 | 0];
        HEAP[$s_addr + 92 | 0] = $211;
        var $214 = HEAP[$s_addr | 0];
        _flush_pending($214);
      }
      var $strstart217 = $s_addr + 108 | 0;
      var $inc218 = HEAP[$strstart217] + 1 | 0;
      HEAP[$strstart217] = $inc218;
      var $lookahead219 = $s_addr + 116 | 0;
      var $dec220 = HEAP[$lookahead219] - 1 | 0;
      HEAP[$lookahead219] = $dec220;
      if ((HEAP[HEAP[$s_addr | 0] + 16 | 0] | 0) != 0) {
        continue;
      }
      $retval = 0;
      break;
    }
    HEAP[$177 + 104 | 0] = 1;
    var $strstart229 = $s_addr + 108 | 0;
    var $inc230 = HEAP[$strstart229] + 1 | 0;
    HEAP[$strstart229] = $inc230;
    var $lookahead231 = $s_addr + 116 | 0;
    var $dec232 = HEAP[$lookahead231] - 1 | 0;
    HEAP[$lookahead231] = $dec232;
  }
  return $retval;
  return null;
}

_deflate_slow["X"] = 1;

function _longest_match($s, $cur_match) {
  var __label__;
  var $retval;
  var $s_addr;
  var $cur_match_addr;
  var $chain_length;
  var $scan;
  var $match;
  var $len;
  var $best_len;
  var $nice_match;
  var $limit;
  var $prev;
  var $wmask;
  var $strend;
  var $scan_end1;
  var $scan_end;
  $s_addr = $s;
  $cur_match_addr = $cur_match;
  $chain_length = HEAP[$s_addr + 124 | 0];
  $scan = HEAP[$s_addr + 56 | 0] + HEAP[$s_addr + 108 | 0] | 0;
  $best_len = HEAP[$s_addr + 120 | 0];
  $nice_match = HEAP[$s_addr + 144 | 0];
  if (HEAP[$s_addr + 108 | 0] >>> 0 > (HEAP[$s_addr + 44 | 0] - 262 | 0) >>> 0) {
    var $cond = HEAP[$s_addr + 108 | 0] + -HEAP[$s_addr + 44 | 0] + 262 | 0;
  } else {
    var $cond = 0;
  }
  var $cond;
  $limit = $cond;
  $prev = HEAP[$s_addr + 64 | 0];
  $wmask = HEAP[$s_addr + 52 | 0];
  $strend = HEAP[$s_addr + 56 | 0] + HEAP[$s_addr + 108 | 0] + 258 | 0;
  $scan_end1 = HEAP[$scan + ($best_len - 1) | 0];
  $scan_end = HEAP[$scan + $best_len | 0];
  if (HEAP[$s_addr + 120 | 0] >>> 0 >= HEAP[$s_addr + 140 | 0] >>> 0) {
    var $shr = $chain_length >>> 2;
    $chain_length = $shr;
  }
  if ($nice_match >>> 0 > HEAP[$s_addr + 116 | 0] >>> 0) {
    $nice_match = HEAP[$s_addr + 116 | 0];
  } else {
    __label__ = 6;
  }
  $do_body$10 : while (1) {
    $match = HEAP[$s_addr + 56 | 0] + $cur_match_addr | 0;
    var $cmp24 = (HEAP[$match + $best_len | 0] & 255 | 0) != ($scan_end & 255 | 0);
    do {
      if (!$cmp24) {
        if ((HEAP[$match + ($best_len - 1) | 0] & 255 | 0) != ($scan_end1 & 255 | 0)) {
          break;
        }
        if ((HEAP[$match] & 255 | 0) != (HEAP[$scan] & 255 | 0)) {
          break;
        }
        var $incdec_ptr = $match + 1 | 0;
        $match = $incdec_ptr;
        if ((HEAP[$incdec_ptr] & 255 | 0) != (HEAP[$scan + 1 | 0] & 255 | 0)) {
          break;
        }
        var $add_ptr45 = $scan + 2 | 0;
        $scan = $add_ptr45;
        var $incdec_ptr46 = $match + 1 | 0;
        $match = $incdec_ptr46;
        while (1) {
          var $incdec_ptr48 = $scan + 1 | 0;
          $scan = $incdec_ptr48;
          var $conv49 = HEAP[$incdec_ptr48] & 255;
          var $incdec_ptr50 = $match + 1 | 0;
          $match = $incdec_ptr50;
          if (($conv49 | 0) != (HEAP[$incdec_ptr50] & 255 | 0)) {
            break;
          }
          var $incdec_ptr54 = $scan + 1 | 0;
          $scan = $incdec_ptr54;
          var $conv55 = HEAP[$incdec_ptr54] & 255;
          var $incdec_ptr56 = $match + 1 | 0;
          $match = $incdec_ptr56;
          if (($conv55 | 0) != (HEAP[$incdec_ptr56] & 255 | 0)) {
            break;
          }
          var $incdec_ptr61 = $scan + 1 | 0;
          $scan = $incdec_ptr61;
          var $conv62 = HEAP[$incdec_ptr61] & 255;
          var $incdec_ptr63 = $match + 1 | 0;
          $match = $incdec_ptr63;
          if (($conv62 | 0) != (HEAP[$incdec_ptr63] & 255 | 0)) {
            break;
          }
          var $incdec_ptr68 = $scan + 1 | 0;
          $scan = $incdec_ptr68;
          var $conv69 = HEAP[$incdec_ptr68] & 255;
          var $incdec_ptr70 = $match + 1 | 0;
          $match = $incdec_ptr70;
          if (($conv69 | 0) != (HEAP[$incdec_ptr70] & 255 | 0)) {
            break;
          }
          var $incdec_ptr75 = $scan + 1 | 0;
          $scan = $incdec_ptr75;
          var $conv76 = HEAP[$incdec_ptr75] & 255;
          var $incdec_ptr77 = $match + 1 | 0;
          $match = $incdec_ptr77;
          if (($conv76 | 0) != (HEAP[$incdec_ptr77] & 255 | 0)) {
            break;
          }
          var $incdec_ptr82 = $scan + 1 | 0;
          $scan = $incdec_ptr82;
          var $conv83 = HEAP[$incdec_ptr82] & 255;
          var $incdec_ptr84 = $match + 1 | 0;
          $match = $incdec_ptr84;
          if (($conv83 | 0) != (HEAP[$incdec_ptr84] & 255 | 0)) {
            break;
          }
          var $incdec_ptr89 = $scan + 1 | 0;
          $scan = $incdec_ptr89;
          var $conv90 = HEAP[$incdec_ptr89] & 255;
          var $incdec_ptr91 = $match + 1 | 0;
          $match = $incdec_ptr91;
          if (($conv90 | 0) != (HEAP[$incdec_ptr91] & 255 | 0)) {
            break;
          }
          var $incdec_ptr96 = $scan + 1 | 0;
          $scan = $incdec_ptr96;
          var $conv97 = HEAP[$incdec_ptr96] & 255;
          var $incdec_ptr98 = $match + 1 | 0;
          $match = $incdec_ptr98;
          if (($conv97 | 0) != (HEAP[$incdec_ptr98] & 255 | 0)) {
            break;
          }
          if ($scan >>> 0 >= $strend >>> 0) {
            break;
          }
        }
        $len = -$strend + -(-$scan) + 258 | 0;
        $scan = $strend - 258 | 0;
        if (($len | 0) <= ($best_len | 0)) {
          break;
        }
        HEAP[$s_addr + 112 | 0] = $cur_match_addr;
        $best_len = $len;
        if (($len | 0) >= ($nice_match | 0)) {
          break $do_body$10;
        }
        $scan_end1 = HEAP[$scan + ($best_len - 1) | 0];
        $scan_end = HEAP[$scan + $best_len | 0];
      }
    } while (0);
    var $conv119 = HEAP[(($wmask & $cur_match_addr) << 1) + $prev | 0] & 65535;
    $cur_match_addr = $conv119;
    if ($conv119 >>> 0 <= $limit >>> 0) {
      break;
    }
    var $dec = $chain_length - 1 | 0;
    $chain_length = $dec;
    if (($dec | 0) == 0) {
      break;
    }
  }
  if ($best_len >>> 0 <= HEAP[$s_addr + 116 | 0] >>> 0) {
    $retval = $best_len;
  } else {
    $retval = HEAP[$s_addr + 116 | 0];
  }
  return $retval;
  return null;
}

_longest_match["X"] = 1;

function _inflateReset($strm) {
  var __label__;
  var $retval;
  var $strm_addr;
  var $state;
  $strm_addr = $strm;
  var $cmp = ($strm_addr | 0) == 0;
  do {
    if (!$cmp) {
      if ((HEAP[$strm_addr + 28 | 0] | 0) == 0) {
        __label__ = 2;
        break;
      }
      $state = HEAP[$strm_addr + 28 | 0];
      HEAP[$state + 28 | 0] = 0;
      HEAP[$strm_addr + 20 | 0] = 0;
      HEAP[$strm_addr + 8 | 0] = 0;
      HEAP[$strm_addr + 24 | 0] = 0;
      HEAP[$strm_addr + 48 | 0] = 1;
      HEAP[$state | 0] = 0;
      HEAP[$state + 4 | 0] = 0;
      HEAP[$state + 12 | 0] = 0;
      HEAP[$state + 20 | 0] = 32768;
      HEAP[$state + 32 | 0] = 0;
      HEAP[$state + 40 | 0] = 0;
      HEAP[$state + 44 | 0] = 0;
      HEAP[$state + 48 | 0] = 0;
      HEAP[$state + 56 | 0] = 0;
      HEAP[$state + 60 | 0] = 0;
      var $arraydecay = $state + 1328 | 0;
      HEAP[$state + 108 | 0] = $arraydecay;
      HEAP[$state + 80 | 0] = $arraydecay;
      HEAP[$state + 76 | 0] = $arraydecay;
      HEAP[$state + 7104 | 0] = 1;
      HEAP[$state + 7108 | 0] = -1;
      $retval = 0;
      __label__ = 4;
      break;
    }
    __label__ = 2;
  } while (0);
  if (__label__ == 2) {
    $retval = -2;
  }
  return $retval;
  return null;
}

_inflateReset["X"] = 1;

function _inflateReset2($strm, $windowBits) {
  var __label__;
  var $retval;
  var $strm_addr;
  var $windowBits_addr;
  var $wrap;
  var $state;
  $strm_addr = $strm;
  $windowBits_addr = $windowBits;
  var $cmp = ($strm_addr | 0) == 0;
  $if_then$$lor_lhs_false$45 : do {
    if (!$cmp) {
      if ((HEAP[$strm_addr + 28 | 0] | 0) == 0) {
        __label__ = 2;
        break;
      }
      $state = HEAP[$strm_addr + 28 | 0];
      var $cmp4 = ($windowBits_addr | 0) < 0;
      do {
        if ($cmp4) {
          $wrap = 0;
          var $sub = -$windowBits_addr | 0;
          $windowBits_addr = $sub;
          var $11 = $sub;
          __label__ = 7;
          break;
        }
        $wrap = ($windowBits_addr >> 4) + 1 | 0;
        if (($windowBits_addr | 0) >= 48) {
          __label__ = 8;
          break;
        }
        var $and = $windowBits_addr & 15;
        $windowBits_addr = $and;
        var $11 = $and;
        __label__ = 7;
        break;
      } while (0);
      do {
        if (__label__ == 7) {
          var $11;
          if (($11 | 0) != 0) {
            __label__ = 8;
            break;
          }
          __label__ = 10;
          break;
        }
      } while (0);
      do {
        if (__label__ == 8) {
          if (!(($windowBits_addr | 0) < 8 | ($windowBits_addr | 0) > 15)) {
            break;
          }
          $retval = -2;
          __label__ = 14;
          break $if_then$$lor_lhs_false$45;
        }
      } while (0);
      var $cmp15 = (HEAP[$state + 52 | 0] | 0) != 0;
      do {
        if ($cmp15) {
          if ((HEAP[$state + 36 | 0] | 0) == ($windowBits_addr | 0)) {
            break;
          }
          var $20 = HEAP[$strm_addr + 36 | 0];
          var $22 = HEAP[$strm_addr + 40 | 0];
          var $24 = HEAP[$state + 52 | 0];
          FUNCTION_TABLE[$20]($22, $24);
          HEAP[$state + 52 | 0] = 0;
        }
      } while (0);
      HEAP[$state + 8 | 0] = $wrap;
      HEAP[$state + 36 | 0] = $windowBits_addr;
      var $call = _inflateReset($strm_addr);
      $retval = $call;
      __label__ = 14;
      break;
    }
    __label__ = 2;
  } while (0);
  if (__label__ == 2) {
    $retval = -2;
  }
  return $retval;
  return null;
}

_inflateReset2["X"] = 1;

function _inflateInit2_($strm, $version, $stream_size) {
  var __label__;
  var $retval;
  var $strm_addr;
  var $windowBits_addr;
  var $version_addr;
  var $stream_size_addr;
  var $ret;
  var $state;
  $strm_addr = $strm;
  $windowBits_addr = 15;
  $version_addr = $version;
  $stream_size_addr = $stream_size;
  var $cmp = ($version_addr | 0) == 0;
  do {
    if ($cmp) {
      __label__ = 3;
    } else {
      if ((HEAP[$version_addr | 0] << 24 >> 24 | 0) != 49) {
        __label__ = 3;
        break;
      }
      if (($stream_size_addr | 0) != 56) {
        __label__ = 3;
        break;
      }
      if (($strm_addr | 0) == 0) {
        $retval = -2;
        __label__ = 15;
        break;
      }
      HEAP[$strm_addr + 24 | 0] = 0;
      if ((HEAP[$strm_addr + 32 | 0] | 0) == 0) {
        HEAP[$strm_addr + 32 | 0] = 2;
        HEAP[$strm_addr + 40 | 0] = 0;
      }
      if ((HEAP[$strm_addr + 36 | 0] | 0) == 0) {
        HEAP[$strm_addr + 36 | 0] = 4;
      }
      var $14 = HEAP[$strm_addr + 32 | 0];
      var $16 = HEAP[$strm_addr + 40 | 0];
      var $call = FUNCTION_TABLE[$14]($16, 1, 7116);
      var $17 = $call;
      $state = $17;
      if (($17 | 0) == 0) {
        $retval = -4;
        __label__ = 15;
        break;
      }
      HEAP[$strm_addr + 28 | 0] = $state;
      HEAP[$state + 52 | 0] = 0;
      var $call28 = _inflateReset2($strm_addr, $windowBits_addr);
      $ret = $call28;
      if (($ret | 0) != 0) {
        var $26 = HEAP[$strm_addr + 36 | 0];
        var $28 = HEAP[$strm_addr + 40 | 0];
        FUNCTION_TABLE[$26]($28, $state);
        HEAP[$strm_addr + 28 | 0] = 0;
      }
      $retval = $ret;
      __label__ = 15;
      break;
    }
  } while (0);
  if (__label__ == 3) {
    $retval = -6;
  }
  return $retval;
  return null;
}

_inflateInit2_["X"] = 1;

function _inflateInit_($strm) {
  var $strm_addr;
  var $version_addr;
  var $stream_size_addr;
  $strm_addr = $strm;
  $version_addr = STRING_TABLE.__str | 0;
  $stream_size_addr = 56;
  var $call = _inflateInit2_($strm_addr, $version_addr, $stream_size_addr);
  return $call;
  return null;
}

function _inflate($strm) {
  var __stackBase__ = STACKTOP;
  STACKTOP += 12;
  var __label__;
  var $retval;
  var $strm_addr;
  var $flush_addr;
  var $state;
  var $next;
  var $put;
  var $have;
  var $left;
  var $hold;
  var $bits;
  var $in;
  var $out;
  var $copy;
  var $from;
  var $here = __stackBase__;
  var $last = __stackBase__ + 4;
  var $len;
  var $ret;
  var $hbuf = __stackBase__ + 8;
  $strm_addr = $strm;
  $flush_addr = 1;
  var $cmp = ($strm_addr | 0) == 0;
  $if_then$$lor_lhs_false$2 : do {
    if (!$cmp) {
      if ((HEAP[$strm_addr + 28 | 0] | 0) == 0) {
        __label__ = 5;
        break;
      }
      if ((HEAP[$strm_addr + 12 | 0] | 0) == 0) {
        __label__ = 5;
        break;
      }
      if ((HEAP[$strm_addr | 0] | 0) == 0) {
        if ((HEAP[$strm_addr + 4 | 0] | 0) != 0) {
          __label__ = 5;
          break;
        }
      }
      $state = HEAP[$strm_addr + 28 | 0];
      if ((HEAP[$state | 0] | 0) == 11) {
        HEAP[$state | 0] = 12;
      }
      $put = HEAP[$strm_addr + 12 | 0];
      $left = HEAP[$strm_addr + 16 | 0];
      $next = HEAP[$strm_addr | 0];
      $have = HEAP[$strm_addr + 4 | 0];
      $hold = HEAP[$state + 56 | 0];
      $bits = HEAP[$state + 60 | 0];
      $in = $have;
      $out = $left;
      $ret = 0;
      var $arrayidx = $hbuf | 0;
      var $arrayidx40 = $hbuf + 1 | 0;
      var $arraydecay = $hbuf | 0;
      var $arrayidx148 = $hbuf | 0;
      var $arrayidx151 = $hbuf + 1 | 0;
      var $arraydecay153 = $hbuf | 0;
      var $arrayidx193 = $hbuf | 0;
      var $arrayidx196 = $hbuf + 1 | 0;
      var $arrayidx199 = $hbuf + 2 | 0;
      var $arrayidx202 = $hbuf + 3 | 0;
      var $arraydecay204 = $hbuf | 0;
      var $arrayidx247 = $hbuf | 0;
      var $arrayidx250 = $hbuf + 1 | 0;
      var $arraydecay252 = $hbuf | 0;
      var $arrayidx296 = $hbuf | 0;
      var $arrayidx299 = $hbuf + 1 | 0;
      var $arraydecay301 = $hbuf | 0;
      var $29 = $here;
      var $bits1217 = $here + 1 | 0;
      var $op = $here | 0;
      var $op1240 = $here | 0;
      var $30 = $last;
      var $31 = $here;
      var $val1247 = $last + 2 | 0;
      var $bits1249 = $last + 1 | 0;
      var $op1251 = $last | 0;
      var $bits1257 = $last + 1 | 0;
      var $32 = $here;
      var $bits1263 = $last + 1 | 0;
      var $bits1265 = $here + 1 | 0;
      var $bits1287 = $last + 1 | 0;
      var $bits1290 = $last + 1 | 0;
      var $bits1295 = $last + 1 | 0;
      var $bits1301 = $here + 1 | 0;
      var $bits1304 = $here + 1 | 0;
      var $bits1309 = $here + 1 | 0;
      var $val1313 = $here + 2 | 0;
      var $op1316 = $here | 0;
      var $op1323 = $here | 0;
      var $op1331 = $here | 0;
      var $op1339 = $here | 0;
      var $33 = $here;
      var $bits892 = $here + 1 | 0;
      var $val = $here + 2 | 0;
      var $val953 = $here + 2 | 0;
      var $val1011 = $here + 2 | 0;
      var $bits1018 = $here + 1 | 0;
      var $bits1041 = $here + 1 | 0;
      var $bits1044 = $here + 1 | 0;
      var $bits1059 = $here + 1 | 0;
      var $bits1082 = $here + 1 | 0;
      var $bits1085 = $here + 1 | 0;
      var $bits960 = $here + 1 | 0;
      var $bits983 = $here + 1 | 0;
      var $bits986 = $here + 1 | 0;
      var $bits917 = $here + 1 | 0;
      var $bits939 = $here + 1 | 0;
      var $bits942 = $here + 1 | 0;
      var $val947 = $here + 2 | 0;
      var $34 = $here;
      var $bits1397 = $here + 1 | 0;
      var $op1417 = $here | 0;
      var $35 = $last;
      var $36 = $here;
      var $val1424 = $last + 2 | 0;
      var $bits1426 = $last + 1 | 0;
      var $op1428 = $last | 0;
      var $bits1434 = $last + 1 | 0;
      var $37 = $here;
      var $bits1440 = $last + 1 | 0;
      var $bits1442 = $here + 1 | 0;
      var $bits1464 = $last + 1 | 0;
      var $bits1467 = $last + 1 | 0;
      var $bits1472 = $last + 1 | 0;
      var $bits1478 = $here + 1 | 0;
      var $bits1481 = $here + 1 | 0;
      var $bits1486 = $here + 1 | 0;
      var $op1490 = $here | 0;
      var $val1498 = $here + 2 | 0;
      var $op1500 = $here | 0;
      $for_cond$12 : while (1) {
        var $39 = HEAP[$state | 0];
        $sw_default$$sw_bb$$while_cond100thread_pre_split$$while_cond163thread_pre_split$$while_cond214thread_pre_split$$sw_bb260$$sw_bb317$$sw_bb373$$sw_bb433$$sw_bb496$$while_cond551thread_pre_split$$sw_bb588$$sw_bb606$$sw_bb614$$do_body680$$sw_bb726$$sw_bb728$$while_cond754thread_pre_split$$while_cond809$$while_cond877$$sw_bb1176$$sw_bb1178$$sw_bb1344$$for_cond1390$$sw_bb1505$$sw_bb1549$$sw_bb1614$$sw_bb1624$$sw_bb1700$$sw_bb1741$$sw_bb1742$14 : do {
          if ($39 == 0) {
            if ((HEAP[$state + 8 | 0] | 0) == 0) {
              HEAP[$state | 0] = 12;
              continue $for_cond$12;
            }
            var $43 = $bits;
            while (1) {
              var $43;
              if ($43 >>> 0 >= 16) {
                break;
              }
              if (($have | 0) == 0) {
                __label__ = 322;
                break $for_cond$12;
              }
              var $dec = $have - 1 | 0;
              $have = $dec;
              var $46 = $next;
              var $incdec_ptr = $46 + 1 | 0;
              $next = $incdec_ptr;
              var $add = ((HEAP[$46] & 255) << $bits) + $hold | 0;
              $hold = $add;
              var $add29 = $bits + 8 | 0;
              $bits = $add29;
              var $43 = $add29;
            }
            var $tobool = (HEAP[$state + 8 | 0] & 2 | 0) != 0;
            do {
              if ($tobool) {
                if (($hold | 0) != 35615) {
                  break;
                }
                var $call = _crc32(0, 0, 0);
                HEAP[$state + 24 | 0] = $call;
                HEAP[$arrayidx] = $hold & 255;
                HEAP[$arrayidx40] = $hold >>> 8 & 255;
                var $58 = HEAP[$state + 24 | 0];
                var $call42 = _crc32($58, $arraydecay, 2);
                HEAP[$state + 24 | 0] = $call42;
                $hold = 0;
                $bits = 0;
                HEAP[$state | 0] = 1;
                continue $for_cond$12;
              }
            } while (0);
            HEAP[$state + 16 | 0] = 0;
            if ((HEAP[$state + 32 | 0] | 0) != 0) {
              var $done = HEAP[$state + 32 | 0] + 48 | 0;
              HEAP[$done] = -1;
            }
            var $tobool56 = (HEAP[$state + 8 | 0] & 1 | 0) != 0;
            do {
              if ($tobool56) {
                if (((((($hold & 255) << 8) + ($hold >>> 8) | 0) >>> 0) % 31 | 0) != 0) {
                  break;
                }
                if (($hold & 15 | 0) != 8) {
                  HEAP[$strm_addr + 24 | 0] = STRING_TABLE.__str216 | 0;
                  HEAP[$state | 0] = 29;
                  continue $for_cond$12;
                }
                var $shr74 = $hold >>> 4;
                $hold = $shr74;
                var $sub = $bits - 4 | 0;
                $bits = $sub;
                $len = ($hold & 15) + 8 | 0;
                var $cmp78 = (HEAP[$state + 36 | 0] | 0) == 0;
                var $80 = $len;
                var $wbits81 = $state + 36 | 0;
                do {
                  if (!$cmp78) {
                    if ($80 >>> 0 <= HEAP[$wbits81] >>> 0) {
                      break;
                    }
                    HEAP[$strm_addr + 24 | 0] = STRING_TABLE.__str317 | 0;
                    HEAP[$state | 0] = 29;
                    continue $for_cond$12;
                  }
                  HEAP[$wbits81] = $80;
                } while (0);
                HEAP[$state + 20 | 0] = 1 << $len;
                var $call91 = _adler32(0, 0, 0);
                HEAP[$state + 24 | 0] = $call91;
                HEAP[$strm_addr + 48 | 0] = $call91;
                var $cond = ($hold & 512 | 0) != 0 ? 9 : 11;
                HEAP[$state | 0] = $cond;
                $hold = 0;
                $bits = 0;
                continue $for_cond$12;
              }
            } while (0);
            HEAP[$strm_addr + 24 | 0] = STRING_TABLE.__str115 | 0;
            HEAP[$state | 0] = 29;
            continue $for_cond$12;
          } else if ($39 == 1) {
            var $91 = $bits;
            while (1) {
              var $91;
              if ($91 >>> 0 >= 16) {
                break;
              }
              if (($have | 0) == 0) {
                __label__ = 322;
                break $for_cond$12;
              }
              var $dec109 = $have - 1 | 0;
              $have = $dec109;
              var $94 = $next;
              var $incdec_ptr110 = $94 + 1 | 0;
              $next = $incdec_ptr110;
              var $add113 = ((HEAP[$94] & 255) << $bits) + $hold | 0;
              $hold = $add113;
              var $add114 = $bits + 8 | 0;
              $bits = $add114;
              var $91 = $add114;
            }
            HEAP[$state + 16 | 0] = $hold;
            if ((HEAP[$state + 16 | 0] & 255 | 0) != 8) {
              HEAP[$strm_addr + 24 | 0] = STRING_TABLE.__str216 | 0;
              HEAP[$state | 0] = 29;
              continue $for_cond$12;
            }
            if ((HEAP[$state + 16 | 0] & 57344 | 0) != 0) {
              HEAP[$strm_addr + 24 | 0] = STRING_TABLE.__str418 | 0;
              HEAP[$state | 0] = 29;
              continue $for_cond$12;
            }
            if ((HEAP[$state + 32 | 0] | 0) != 0) {
              var $text = HEAP[$state + 32 | 0] | 0;
              HEAP[$text] = $hold >>> 8 & 1;
            }
            if ((HEAP[$state + 16 | 0] & 512 | 0) != 0) {
              HEAP[$arrayidx148] = $hold & 255;
              HEAP[$arrayidx151] = $hold >>> 8 & 255;
              var $119 = HEAP[$state + 24 | 0];
              var $call154 = _crc32($119, $arraydecay153, 2);
              HEAP[$state + 24 | 0] = $call154;
            }
            $hold = 0;
            $bits = 0;
            HEAP[$state | 0] = 2;
            __label__ = 44;
            break;
          } else if ($39 == 2) {
            __label__ = 44;
          } else if ($39 == 3) {
            __label__ = 53;
          } else if ($39 == 4) {
            __label__ = 62;
          } else if ($39 == 5) {
            __label__ = 75;
          } else if ($39 == 6) {
            __label__ = 90;
          } else if ($39 == 7) {
            __label__ = 106;
          } else if ($39 == 8) {
            __label__ = 122;
          } else if ($39 == 9) {
            var $360 = $bits;
            while (1) {
              var $360;
              if ($360 >>> 0 >= 32) {
                break;
              }
              if (($have | 0) == 0) {
                __label__ = 322;
                break $for_cond$12;
              }
              var $dec560 = $have - 1 | 0;
              $have = $dec560;
              var $363 = $next;
              var $incdec_ptr561 = $363 + 1 | 0;
              $next = $incdec_ptr561;
              var $add564 = ((HEAP[$363] & 255) << $bits) + $hold | 0;
              $hold = $add564;
              var $add565 = $bits + 8 | 0;
              $bits = $add565;
              var $360 = $add565;
            }
            var $add581 = (($hold & 65280) << 8) + (($hold & 255) << 24) + ($hold >>> 8 & 65280) + ($hold >>> 24 & 255) | 0;
            HEAP[$state + 24 | 0] = $add581;
            HEAP[$strm_addr + 48 | 0] = $add581;
            $hold = 0;
            $bits = 0;
            HEAP[$state | 0] = 10;
            __label__ = 138;
            break;
          } else if ($39 == 10) {
            __label__ = 138;
          } else if ($39 == 11) {
            __label__ = 141;
          } else if ($39 == 12) {
            __label__ = 142;
          } else if ($39 == 13) {
            var $shr682 = $hold >>> (($bits & 7) >>> 0);
            $hold = $shr682;
            var $sub684 = $bits - ($bits & 7) | 0;
            $bits = $sub684;
            var $429 = $sub684;
            while (1) {
              var $429;
              if ($429 >>> 0 >= 32) {
                break;
              }
              if (($have | 0) == 0) {
                __label__ = 322;
                break $for_cond$12;
              }
              var $dec697 = $have - 1 | 0;
              $have = $dec697;
              var $432 = $next;
              var $incdec_ptr698 = $432 + 1 | 0;
              $next = $incdec_ptr698;
              var $add701 = ((HEAP[$432] & 255) << $bits) + $hold | 0;
              $hold = $add701;
              var $add702 = $bits + 8 | 0;
              $bits = $add702;
              var $429 = $add702;
            }
            if (($hold & 65535 | 0) != ($hold >>> 16 ^ 65535 | 0)) {
              HEAP[$strm_addr + 24 | 0] = STRING_TABLE.__str721 | 0;
              HEAP[$state | 0] = 29;
              continue $for_cond$12;
            }
            HEAP[$state + 64 | 0] = $hold & 65535;
            $hold = 0;
            $bits = 0;
            HEAP[$state | 0] = 14;
            if (($flush_addr | 0) == 6) {
              __label__ = 322;
              break $for_cond$12;
            }
            __label__ = 161;
            break;
          } else if ($39 == 14) {
            __label__ = 161;
          } else if ($39 == 15) {
            __label__ = 162;
          } else if ($39 == 16) {
            var $470 = $bits;
            while (1) {
              var $470;
              if ($470 >>> 0 >= 14) {
                break;
              }
              if (($have | 0) == 0) {
                __label__ = 322;
                break $for_cond$12;
              }
              var $dec763 = $have - 1 | 0;
              $have = $dec763;
              var $473 = $next;
              var $incdec_ptr764 = $473 + 1 | 0;
              $next = $incdec_ptr764;
              var $add767 = ((HEAP[$473] & 255) << $bits) + $hold | 0;
              $hold = $add767;
              var $add768 = $bits + 8 | 0;
              $bits = $add768;
              var $470 = $add768;
            }
            HEAP[$state + 96 | 0] = ($hold & 31) + 257 | 0;
            var $shr777 = $hold >>> 5;
            $hold = $shr777;
            var $sub778 = $bits - 5 | 0;
            $bits = $sub778;
            HEAP[$state + 100 | 0] = ($hold & 31) + 1 | 0;
            var $shr784 = $hold >>> 5;
            $hold = $shr784;
            var $sub785 = $bits - 5 | 0;
            $bits = $sub785;
            HEAP[$state + 92 | 0] = ($hold & 15) + 4 | 0;
            var $shr791 = $hold >>> 4;
            $hold = $shr791;
            var $sub792 = $bits - 4 | 0;
            $bits = $sub792;
            var $cmp796 = HEAP[$state + 96 | 0] >>> 0 > 286;
            do {
              if (!$cmp796) {
                if (HEAP[$state + 100 | 0] >>> 0 > 30) {
                  break;
                }
                HEAP[$state + 104 | 0] = 0;
                HEAP[$state | 0] = 17;
                __label__ = 178;
                break $sw_default$$sw_bb$$while_cond100thread_pre_split$$while_cond163thread_pre_split$$while_cond214thread_pre_split$$sw_bb260$$sw_bb317$$sw_bb373$$sw_bb433$$sw_bb496$$while_cond551thread_pre_split$$sw_bb588$$sw_bb606$$sw_bb614$$do_body680$$sw_bb726$$sw_bb728$$while_cond754thread_pre_split$$while_cond809$$while_cond877$$sw_bb1176$$sw_bb1178$$sw_bb1344$$for_cond1390$$sw_bb1505$$sw_bb1549$$sw_bb1614$$sw_bb1624$$sw_bb1700$$sw_bb1741$$sw_bb1742$14;
              }
            } while (0);
            HEAP[$strm_addr + 24 | 0] = STRING_TABLE.__str822 | 0;
            HEAP[$state | 0] = 29;
            continue $for_cond$12;
          } else if ($39 == 17) {
            __label__ = 178;
          } else if ($39 == 18) {
            __label__ = 189;
          } else if ($39 == 19) {
            __label__ = 226;
          } else if ($39 == 20) {
            __label__ = 227;
          } else if ($39 == 21) {
            __label__ = 249;
          } else if ($39 == 22) {
            __label__ = 255;
          } else if ($39 == 23) {
            __label__ = 267;
          } else if ($39 == 24) {
            __label__ = 273;
          } else if ($39 == 25) {
            if (($left | 0) == 0) {
              __label__ = 322;
              break $for_cond$12;
            }
            var $conv1620 = HEAP[$state + 64 | 0] & 255;
            var $959 = $put;
            var $incdec_ptr1621 = $959 + 1 | 0;
            $put = $incdec_ptr1621;
            HEAP[$959] = $conv1620;
            var $dec1622 = $left - 1 | 0;
            $left = $dec1622;
            HEAP[$state | 0] = 20;
            continue $for_cond$12;
          } else if ($39 == 26) {
            if ((HEAP[$state + 8 | 0] | 0) != 0) {
              var $964 = $bits;
              while (1) {
                var $964;
                if ($964 >>> 0 >= 32) {
                  break;
                }
                if (($have | 0) == 0) {
                  __label__ = 322;
                  break $for_cond$12;
                }
                var $dec1638 = $have - 1 | 0;
                $have = $dec1638;
                var $967 = $next;
                var $incdec_ptr1639 = $967 + 1 | 0;
                $next = $incdec_ptr1639;
                var $add1642 = ((HEAP[$967] & 255) << $bits) + $hold | 0;
                $hold = $add1642;
                var $add1643 = $bits + 8 | 0;
                $bits = $add1643;
                var $964 = $add1643;
              }
              var $sub1649 = $out - $left | 0;
              $out = $sub1649;
              var $total_out = $strm_addr + 20 | 0;
              var $add1650 = HEAP[$total_out] + $out | 0;
              HEAP[$total_out] = $add1650;
              var $total = $state + 28 | 0;
              var $add1651 = HEAP[$total] + $out | 0;
              HEAP[$total] = $add1651;
              if (($out | 0) != 0) {
                var $984 = HEAP[$state + 24 | 0];
                var $add_ptr1659 = $put + -$out | 0;
                var $987 = $out;
                if ((HEAP[$state + 16 | 0] | 0) != 0) {
                  var $call1660 = _crc32($984, $add_ptr1659, $987);
                  var $cond1667 = $call1660;
                } else {
                  var $call1665 = _adler32($984, $add_ptr1659, $987);
                  var $cond1667 = $call1665;
                }
                var $cond1667;
                HEAP[$state + 24 | 0] = $cond1667;
                HEAP[$strm_addr + 48 | 0] = $cond1667;
              }
              $out = $left;
              var $993 = $hold;
              if ((HEAP[$state + 16 | 0] | 0) != 0) {
                var $cond1687 = $993;
              } else {
                var $cond1687 = (($hold & 65280) << 8) + (($hold & 255) << 24) + ($hold >>> 8 & 65280) + ($993 >>> 24 & 255) | 0;
              }
              var $cond1687;
              if (($cond1687 | 0) != (HEAP[$state + 24 | 0] | 0)) {
                HEAP[$strm_addr + 24 | 0] = STRING_TABLE.__str17 | 0;
                HEAP[$state | 0] = 29;
                continue $for_cond$12;
              }
              $hold = 0;
              $bits = 0;
            }
            HEAP[$state | 0] = 27;
            __label__ = 308;
            break;
          } else if ($39 == 27) {
            __label__ = 308;
          } else if ($39 == 28) {
            __label__ = 318;
            break $for_cond$12;
          } else if ($39 == 29) {
            $ret = -3;
            __label__ = 322;
            break $for_cond$12;
          } else if ($39 == 30) {
            $retval = -4;
            __label__ = 341;
            break $if_then$$lor_lhs_false$2;
          } else {
            $retval = -2;
            __label__ = 341;
            break $if_then$$lor_lhs_false$2;
          }
        } while (0);
        do {
          if (__label__ == 44) {
            var $122 = $bits;
            while (1) {
              var $122;
              if ($122 >>> 0 >= 32) {
                break;
              }
              if (($have | 0) == 0) {
                __label__ = 322;
                break $for_cond$12;
              }
              var $dec172 = $have - 1 | 0;
              $have = $dec172;
              var $125 = $next;
              var $incdec_ptr173 = $125 + 1 | 0;
              $next = $incdec_ptr173;
              var $add176 = ((HEAP[$125] & 255) << $bits) + $hold | 0;
              $hold = $add176;
              var $add177 = $bits + 8 | 0;
              $bits = $add177;
              var $122 = $add177;
            }
            if ((HEAP[$state + 32 | 0] | 0) != 0) {
              var $time = HEAP[$state + 32 | 0] + 4 | 0;
              HEAP[$time] = $hold;
            }
            if ((HEAP[$state + 16 | 0] & 512 | 0) != 0) {
              HEAP[$arrayidx193] = $hold & 255;
              HEAP[$arrayidx196] = $hold >>> 8 & 255;
              HEAP[$arrayidx199] = $hold >>> 16 & 255;
              HEAP[$arrayidx202] = $hold >>> 24 & 255;
              var $142 = HEAP[$state + 24 | 0];
              var $call205 = _crc32($142, $arraydecay204, 4);
              HEAP[$state + 24 | 0] = $call205;
            }
            $hold = 0;
            $bits = 0;
            HEAP[$state | 0] = 3;
            __label__ = 53;
            break;
          } else if (__label__ == 138) {
            if ((HEAP[$state + 12 | 0] | 0) == 0) {
              HEAP[$strm_addr + 12 | 0] = $put;
              HEAP[$strm_addr + 16 | 0] = $left;
              HEAP[$strm_addr | 0] = $next;
              HEAP[$strm_addr + 4 | 0] = $have;
              HEAP[$state + 56 | 0] = $hold;
              HEAP[$state + 60 | 0] = $bits;
              $retval = 2;
              __label__ = 341;
              break $if_then$$lor_lhs_false$2;
            }
            var $call602 = _adler32(0, 0, 0);
            HEAP[$state + 24 | 0] = $call602;
            HEAP[$strm_addr + 48 | 0] = $call602;
            HEAP[$state | 0] = 11;
            __label__ = 141;
            break;
          } else if (__label__ == 161) {
            HEAP[$state | 0] = 15;
            __label__ = 162;
            break;
          } else if (__label__ == 178) {
            while (1) {
              if (HEAP[$state + 104 | 0] >>> 0 >= HEAP[$state + 92 | 0] >>> 0) {
                break;
              }
              var $502 = $bits;
              while (1) {
                var $502;
                if ($502 >>> 0 >= 3) {
                  break;
                }
                if (($have | 0) == 0) {
                  __label__ = 322;
                  break $for_cond$12;
                }
                var $dec825 = $have - 1 | 0;
                $have = $dec825;
                var $505 = $next;
                var $incdec_ptr826 = $505 + 1 | 0;
                $next = $incdec_ptr826;
                var $add829 = ((HEAP[$505] & 255) << $bits) + $hold | 0;
                $hold = $add829;
                var $add830 = $bits + 8 | 0;
                $bits = $add830;
                var $502 = $add830;
              }
              var $have838 = $state + 104 | 0;
              var $512 = HEAP[$have838];
              var $inc839 = $512 + 1 | 0;
              HEAP[$have838] = $inc839;
              var $arrayidx841 = ((HEAP[($512 << 1) + _inflate_order | 0] & 65535) << 1) + $state + 112 | 0;
              HEAP[$arrayidx841] = $hold & 7 & 65535;
              var $shr843 = $hold >>> 3;
              $hold = $shr843;
              var $sub844 = $bits - 3 | 0;
              $bits = $sub844;
            }
            var $cmp85029 = HEAP[$state + 104 | 0] >>> 0 < 19;
            var $519 = $state;
            $while_body852$$while_end859$140 : do {
              if ($cmp85029) {
                var $520 = $519;
                while (1) {
                  var $520;
                  var $have853 = $520 + 104 | 0;
                  var $521 = HEAP[$have853];
                  var $inc854 = $521 + 1 | 0;
                  HEAP[$have853] = $inc854;
                  var $arrayidx858 = ((HEAP[($521 << 1) + _inflate_order | 0] & 65535) << 1) + $state + 112 | 0;
                  HEAP[$arrayidx858] = 0;
                  var $526 = $state;
                  if (HEAP[$state + 104 | 0] >>> 0 >= 19) {
                    var $_lcssa = $526;
                    break $while_body852$$while_end859$140;
                  }
                  var $520 = $526;
                }
              } else {
                var $_lcssa = $519;
              }
            } while (0);
            var $_lcssa;
            HEAP[$state + 108 | 0] = $_lcssa + 1328 | 0;
            var $529 = HEAP[$state + 108 | 0];
            HEAP[$state + 76 | 0] = $529;
            HEAP[$state + 84 | 0] = 7;
            var $call868 = _inflate_table(0, $state + 112 | 0, 19, $state + 108 | 0, $state + 84 | 0, $state + 752 | 0);
            $ret = $call868;
            if (($call868 | 0) != 0) {
              HEAP[$strm_addr + 24 | 0] = STRING_TABLE.__str923 | 0;
              HEAP[$state | 0] = 29;
              continue $for_cond$12;
            }
            HEAP[$state + 104 | 0] = 0;
            HEAP[$state | 0] = 18;
            __label__ = 189;
            break;
          } else if (__label__ == 308) {
            if ((HEAP[$state + 8 | 0] | 0) == 0) {
              __label__ = 317;
              break $for_cond$12;
            }
            if ((HEAP[$state + 16 | 0] | 0) == 0) {
              __label__ = 317;
              break $for_cond$12;
            }
            var $1006 = $bits;
            while (1) {
              var $1006;
              if ($1006 >>> 0 >= 32) {
                break;
              }
              if (($have | 0) == 0) {
                __label__ = 322;
                break $for_cond$12;
              }
              var $dec1717 = $have - 1 | 0;
              $have = $dec1717;
              var $1009 = $next;
              var $incdec_ptr1718 = $1009 + 1 | 0;
              $next = $incdec_ptr1718;
              var $add1721 = ((HEAP[$1009] & 255) << $bits) + $hold | 0;
              $hold = $add1721;
              var $add1722 = $bits + 8 | 0;
              $bits = $add1722;
              var $1006 = $add1722;
            }
            if (($hold | 0) != (HEAP[$state + 28 | 0] | 0)) {
              HEAP[$strm_addr + 24 | 0] = STRING_TABLE.__str18 | 0;
              HEAP[$state | 0] = 29;
              continue $for_cond$12;
            }
            $hold = 0;
            $bits = 0;
            __label__ = 317;
            break $for_cond$12;
          }
        } while (0);
        do {
          if (__label__ == 53) {
            var $145 = $bits;
            while (1) {
              var $145;
              if ($145 >>> 0 >= 16) {
                break;
              }
              if (($have | 0) == 0) {
                __label__ = 322;
                break $for_cond$12;
              }
              var $dec223 = $have - 1 | 0;
              $have = $dec223;
              var $148 = $next;
              var $incdec_ptr224 = $148 + 1 | 0;
              $next = $incdec_ptr224;
              var $add227 = ((HEAP[$148] & 255) << $bits) + $hold | 0;
              $hold = $add227;
              var $add228 = $bits + 8 | 0;
              $bits = $add228;
              var $145 = $add228;
            }
            if ((HEAP[$state + 32 | 0] | 0) != 0) {
              var $xflags = HEAP[$state + 32 | 0] + 8 | 0;
              HEAP[$xflags] = $hold & 255;
              var $os = HEAP[$state + 32 | 0] + 12 | 0;
              HEAP[$os] = $hold >>> 8;
            }
            if ((HEAP[$state + 16 | 0] & 512 | 0) != 0) {
              HEAP[$arrayidx247] = $hold & 255;
              HEAP[$arrayidx250] = $hold >>> 8 & 255;
              var $166 = HEAP[$state + 24 | 0];
              var $call253 = _crc32($166, $arraydecay252, 2);
              HEAP[$state + 24 | 0] = $call253;
            }
            $hold = 0;
            $bits = 0;
            HEAP[$state | 0] = 4;
            __label__ = 62;
            break;
          } else if (__label__ == 141) {
            if (($flush_addr | 0) == 5 | ($flush_addr | 0) == 6) {
              __label__ = 322;
              break $for_cond$12;
            }
            __label__ = 142;
            break;
          } else if (__label__ == 162) {
            var $447 = HEAP[$state + 64 | 0];
            $copy = $447;
            if (($447 | 0) != 0) {
              if ($copy >>> 0 > $have >>> 0) {
                $copy = $have;
              }
              var $451 = $copy;
              if ($451 >>> 0 > $left >>> 0) {
                var $453 = $left;
                $copy = $453;
                var $454 = $453;
              } else {
                var $454 = $451;
              }
              var $454;
              if (($454 | 0) == 0) {
                __label__ = 322;
                break $for_cond$12;
              }
              var $455 = $put;
              var $456 = $next;
              var $457 = $copy;
              for (var $$src = $456, $$dest = $455, $$stop = $$src + $457; $$src < $$stop; $$src++, $$dest++) {
                HEAP[$$dest] = HEAP[$$src];
              }
              var $sub744 = $have - $copy | 0;
              $have = $sub744;
              var $add_ptr745 = $next + $copy | 0;
              $next = $add_ptr745;
              var $sub746 = $left - $copy | 0;
              $left = $sub746;
              var $add_ptr747 = $put + $copy | 0;
              $put = $add_ptr747;
              var $length748 = $state + 64 | 0;
              var $sub749 = HEAP[$length748] - $copy | 0;
              HEAP[$length748] = $sub749;
              continue $for_cond$12;
            }
            HEAP[$state | 0] = 11;
            continue $for_cond$12;
          } else if (__label__ == 189) {
            $while_cond877$183 : while (1) {
              if (HEAP[$state + 104 | 0] >>> 0 >= (HEAP[$state + 100 | 0] + HEAP[$state + 96 | 0] | 0) >>> 0) {
                break;
              }
              while (1) {
                var $551 = (((1 << HEAP[$state + 84 | 0]) - 1 & $hold) << 2) + HEAP[$state + 76 | 0] | 0;
                HEAP[$33] = HEAP[$551];
                HEAP[$33 + 1] = HEAP[$551 + 1];
                HEAP[$33 + 2] = HEAP[$551 + 2];
                HEAP[$33 + 3] = HEAP[$551 + 3];
                if ((HEAP[$bits892] & 255) >>> 0 <= $bits >>> 0) {
                  break;
                }
                if (($have | 0) == 0) {
                  __label__ = 322;
                  break $for_cond$12;
                }
                var $dec903 = $have - 1 | 0;
                $have = $dec903;
                var $556 = $next;
                var $incdec_ptr904 = $556 + 1 | 0;
                $next = $incdec_ptr904;
                var $add907 = ((HEAP[$556] & 255) << $bits) + $hold | 0;
                $hold = $add907;
                var $add908 = $bits + 8 | 0;
                $bits = $add908;
              }
              if ((HEAP[$val] & 65535 | 0) < 16) {
                while (1) {
                  if ($bits >>> 0 >= (HEAP[$bits917] & 255) >>> 0) {
                    break;
                  }
                  if (($have | 0) == 0) {
                    __label__ = 322;
                    break $for_cond$12;
                  }
                  var $dec927 = $have - 1 | 0;
                  $have = $dec927;
                  var $566 = $next;
                  var $incdec_ptr928 = $566 + 1 | 0;
                  $next = $incdec_ptr928;
                  var $add931 = ((HEAP[$566] & 255) << $bits) + $hold | 0;
                  $hold = $add931;
                  var $add932 = $bits + 8 | 0;
                  $bits = $add932;
                }
                var $shr941 = $hold >>> ((HEAP[$bits939] & 255) >>> 0);
                $hold = $shr941;
                var $sub944 = $bits - (HEAP[$bits942] & 255) | 0;
                $bits = $sub944;
                var $575 = HEAP[$val947];
                var $have948 = $state + 104 | 0;
                var $577 = HEAP[$have948];
                var $inc949 = $577 + 1 | 0;
                HEAP[$have948] = $inc949;
                var $arrayidx951 = ($577 << 1) + $state + 112 | 0;
                HEAP[$arrayidx951] = $575;
              } else {
                if ((HEAP[$val953] & 65535 | 0) == 16) {
                  while (1) {
                    if ($bits >>> 0 >= ((HEAP[$bits960] & 255) + 2 | 0) >>> 0) {
                      break;
                    }
                    if (($have | 0) == 0) {
                      __label__ = 322;
                      break $for_cond$12;
                    }
                    var $dec971 = $have - 1 | 0;
                    $have = $dec971;
                    var $584 = $next;
                    var $incdec_ptr972 = $584 + 1 | 0;
                    $next = $incdec_ptr972;
                    var $add975 = ((HEAP[$584] & 255) << $bits) + $hold | 0;
                    $hold = $add975;
                    var $add976 = $bits + 8 | 0;
                    $bits = $add976;
                  }
                  var $shr985 = $hold >>> ((HEAP[$bits983] & 255) >>> 0);
                  $hold = $shr985;
                  var $sub988 = $bits - (HEAP[$bits986] & 255) | 0;
                  $bits = $sub988;
                  if ((HEAP[$state + 104 | 0] | 0) == 0) {
                    HEAP[$strm_addr + 24 | 0] = STRING_TABLE.__str1024 | 0;
                    HEAP[$state | 0] = 29;
                    break;
                  }
                  $len = HEAP[(HEAP[$state + 104 | 0] - 1 << 1) + $state + 112 | 0] & 65535;
                  $copy = ($hold & 3) + 3 | 0;
                  var $shr1006 = $hold >>> 2;
                  $hold = $shr1006;
                  var $sub1007 = $bits - 2 | 0;
                  $bits = $sub1007;
                } else {
                  if ((HEAP[$val1011] & 65535 | 0) == 17) {
                    while (1) {
                      if ($bits >>> 0 >= ((HEAP[$bits1018] & 255) + 3 | 0) >>> 0) {
                        break;
                      }
                      if (($have | 0) == 0) {
                        __label__ = 322;
                        break $for_cond$12;
                      }
                      var $dec1029 = $have - 1 | 0;
                      $have = $dec1029;
                      var $609 = $next;
                      var $incdec_ptr1030 = $609 + 1 | 0;
                      $next = $incdec_ptr1030;
                      var $add1033 = ((HEAP[$609] & 255) << $bits) + $hold | 0;
                      $hold = $add1033;
                      var $add1034 = $bits + 8 | 0;
                      $bits = $add1034;
                    }
                    var $shr1043 = $hold >>> ((HEAP[$bits1041] & 255) >>> 0);
                    $hold = $shr1043;
                    var $sub1046 = $bits - (HEAP[$bits1044] & 255) | 0;
                    $bits = $sub1046;
                    $len = 0;
                    $copy = ($hold & 7) + 3 | 0;
                    var $shr1052 = $hold >>> 3;
                    $hold = $shr1052;
                    var $sub1053 = $bits - 3 | 0;
                    $bits = $sub1053;
                  } else {
                    while (1) {
                      if ($bits >>> 0 >= ((HEAP[$bits1059] & 255) + 7 | 0) >>> 0) {
                        break;
                      }
                      if (($have | 0) == 0) {
                        __label__ = 322;
                        break $for_cond$12;
                      }
                      var $dec1070 = $have - 1 | 0;
                      $have = $dec1070;
                      var $625 = $next;
                      var $incdec_ptr1071 = $625 + 1 | 0;
                      $next = $incdec_ptr1071;
                      var $add1074 = ((HEAP[$625] & 255) << $bits) + $hold | 0;
                      $hold = $add1074;
                      var $add1075 = $bits + 8 | 0;
                      $bits = $add1075;
                    }
                    var $shr1084 = $hold >>> ((HEAP[$bits1082] & 255) >>> 0);
                    $hold = $shr1084;
                    var $sub1087 = $bits - (HEAP[$bits1085] & 255) | 0;
                    $bits = $sub1087;
                    $len = 0;
                    $copy = ($hold & 127) + 11 | 0;
                    var $shr1093 = $hold >>> 7;
                    $hold = $shr1093;
                    var $sub1094 = $bits - 7 | 0;
                    $bits = $sub1094;
                  }
                }
                if (($copy + HEAP[$state + 104 | 0] | 0) >>> 0 > (HEAP[$state + 100 | 0] + HEAP[$state + 96 | 0] | 0) >>> 0) {
                  HEAP[$strm_addr + 24 | 0] = STRING_TABLE.__str1024 | 0;
                  HEAP[$state | 0] = 29;
                  break;
                }
                var $644 = $copy;
                var $dec111135 = $644 - 1 | 0;
                $copy = $dec111135;
                if (($644 | 0) == 0) {
                  continue;
                }
                while (1) {
                  var $have1115 = $state + 104 | 0;
                  var $649 = HEAP[$have1115];
                  var $inc1116 = $649 + 1 | 0;
                  HEAP[$have1115] = $inc1116;
                  var $arrayidx1118 = ($649 << 1) + $state + 112 | 0;
                  HEAP[$arrayidx1118] = $len & 65535;
                  var $651 = $copy;
                  var $dec1111 = $651 - 1 | 0;
                  $copy = $dec1111;
                  if (($651 | 0) == 0) {
                    continue $while_cond877$183;
                  }
                }
              }
            }
            if ((HEAP[$state | 0] | 0) == 29) {
              continue $for_cond$12;
            }
            if ((HEAP[$state + 624 | 0] & 65535 | 0) == 0) {
              HEAP[$strm_addr + 24 | 0] = STRING_TABLE.__str1125 | 0;
              HEAP[$state | 0] = 29;
              continue $for_cond$12;
            }
            HEAP[$state + 108 | 0] = $state + 1328 | 0;
            var $661 = HEAP[$state + 108 | 0];
            HEAP[$state + 76 | 0] = $661;
            HEAP[$state + 84 | 0] = 9;
            var $666 = HEAP[$state + 96 | 0];
            var $call1149 = _inflate_table(1, $state + 112 | 0, $666, $state + 108 | 0, $state + 84 | 0, $state + 752 | 0);
            $ret = $call1149;
            if (($ret | 0) != 0) {
              HEAP[$strm_addr + 24 | 0] = STRING_TABLE.__str1226 | 0;
              HEAP[$state | 0] = 29;
              continue $for_cond$12;
            }
            var $674 = HEAP[$state + 108 | 0];
            HEAP[$state + 80 | 0] = $674;
            HEAP[$state + 88 | 0] = 6;
            var $add_ptr1159 = (HEAP[$state + 96 | 0] << 1) + $state + 112 | 0;
            var $681 = HEAP[$state + 100 | 0];
            var $call1165 = _inflate_table(2, $add_ptr1159, $681, $state + 108 | 0, $state + 88 | 0, $state + 752 | 0);
            $ret = $call1165;
            if (($ret | 0) != 0) {
              HEAP[$strm_addr + 24 | 0] = STRING_TABLE.__str1327 | 0;
              HEAP[$state | 0] = 29;
              continue $for_cond$12;
            }
            HEAP[$state | 0] = 19;
            if (($flush_addr | 0) == 6) {
              __label__ = 322;
              break $for_cond$12;
            }
            __label__ = 226;
            break;
          }
        } while (0);
        do {
          if (__label__ == 62) {
            var $tobool263 = (HEAP[$state + 16 | 0] & 1024 | 0) != 0;
            do {
              if ($tobool263) {
                var $171 = $bits;
                while (1) {
                  var $171;
                  if ($171 >>> 0 >= 16) {
                    break;
                  }
                  if (($have | 0) == 0) {
                    __label__ = 322;
                    break $for_cond$12;
                  }
                  var $dec275 = $have - 1 | 0;
                  $have = $dec275;
                  var $174 = $next;
                  var $incdec_ptr276 = $174 + 1 | 0;
                  $next = $incdec_ptr276;
                  var $add279 = ((HEAP[$174] & 255) << $bits) + $hold | 0;
                  $hold = $add279;
                  var $add280 = $bits + 8 | 0;
                  $bits = $add280;
                  var $171 = $add280;
                }
                HEAP[$state + 64 | 0] = $hold;
                if ((HEAP[$state + 32 | 0] | 0) != 0) {
                  var $extra_len = HEAP[$state + 32 | 0] + 20 | 0;
                  HEAP[$extra_len] = $hold;
                }
                if ((HEAP[$state + 16 | 0] & 512 | 0) != 0) {
                  HEAP[$arrayidx296] = $hold & 255;
                  HEAP[$arrayidx299] = $hold >>> 8 & 255;
                  var $191 = HEAP[$state + 24 | 0];
                  var $call302 = _crc32($191, $arraydecay301, 2);
                  HEAP[$state + 24 | 0] = $call302;
                }
                $hold = 0;
                $bits = 0;
              } else {
                if ((HEAP[$state + 32 | 0] | 0) == 0) {
                  break;
                }
                var $extra = HEAP[$state + 32 | 0] + 16 | 0;
                HEAP[$extra] = 0;
              }
            } while (0);
            HEAP[$state | 0] = 5;
            __label__ = 75;
            break;
          } else if (__label__ == 142) {
            var $396 = $bits;
            if ((HEAP[$state + 4 | 0] | 0) != 0) {
              var $shr620 = $hold >>> (($396 & 7) >>> 0);
              $hold = $shr620;
              var $sub622 = $bits - ($bits & 7) | 0;
              $bits = $sub622;
              HEAP[$state | 0] = 26;
              continue $for_cond$12;
            }
            var $401 = $396;
            while (1) {
              var $401;
              if ($401 >>> 0 >= 3) {
                break;
              }
              if (($have | 0) == 0) {
                __label__ = 322;
                break $for_cond$12;
              }
              var $dec637 = $have - 1 | 0;
              $have = $dec637;
              var $404 = $next;
              var $incdec_ptr638 = $404 + 1 | 0;
              $next = $incdec_ptr638;
              var $add641 = ((HEAP[$404] & 255) << $bits) + $hold | 0;
              $hold = $add641;
              var $add642 = $bits + 8 | 0;
              $bits = $add642;
              var $401 = $add642;
            }
            HEAP[$state + 4 | 0] = $hold & 1;
            var $shr651 = $hold >>> 1;
            $hold = $shr651;
            var $sub652 = $bits - 1 | 0;
            $bits = $sub652;
            var $and655 = $hold & 3;
            do {
              if ($and655 == 0) {
                HEAP[$state | 0] = 13;
              } else if ($and655 == 1) {
                _fixedtables($state);
                HEAP[$state | 0] = 19;
                if (($flush_addr | 0) != 6) {
                  break;
                }
                var $shr664 = $hold >>> 2;
                $hold = $shr664;
                var $sub665 = $bits - 2 | 0;
                $bits = $sub665;
                __label__ = 322;
                break $for_cond$12;
              } else if ($and655 == 2) {
                HEAP[$state | 0] = 16;
              } else if ($and655 == 3) {
                HEAP[$strm_addr + 24 | 0] = STRING_TABLE.__str620 | 0;
                HEAP[$state | 0] = 29;
              }
            } while (0);
            var $shr675 = $hold >>> 2;
            $hold = $shr675;
            var $sub676 = $bits - 2 | 0;
            $bits = $sub676;
            continue $for_cond$12;
          } else if (__label__ == 226) {
            HEAP[$state | 0] = 20;
            __label__ = 227;
            break;
          }
        } while (0);
        do {
          if (__label__ == 75) {
            if ((HEAP[$state + 16 | 0] & 1024 | 0) != 0) {
              $copy = HEAP[$state + 64 | 0];
              var $202 = $copy;
              if ($202 >>> 0 > $have >>> 0) {
                var $204 = $have;
                $copy = $204;
                var $205 = $204;
              } else {
                var $205 = $202;
              }
              var $205;
              if (($205 | 0) != 0) {
                var $cmp330 = (HEAP[$state + 32 | 0] | 0) != 0;
                do {
                  if ($cmp330) {
                    if ((HEAP[HEAP[$state + 32 | 0] + 16 | 0] | 0) == 0) {
                      break;
                    }
                    $len = HEAP[HEAP[$state + 32 | 0] + 20 | 0] - HEAP[$state + 64 | 0] | 0;
                    var $add_ptr = HEAP[HEAP[$state + 32 | 0] + 16 | 0] + $len | 0;
                    var $220 = $next;
                    if (($copy + $len | 0) >>> 0 > HEAP[HEAP[$state + 32 | 0] + 24 | 0] >>> 0) {
                      var $cond351 = HEAP[HEAP[$state + 32 | 0] + 24 | 0] - $len | 0;
                    } else {
                      var $cond351 = $copy;
                    }
                    var $cond351;
                    for (var $$src = $220, $$dest = $add_ptr, $$stop = $$src + $cond351; $$src < $$stop; $$src++, $$dest++) {
                      HEAP[$$dest] = HEAP[$$src];
                    }
                  }
                } while (0);
                if ((HEAP[$state + 16 | 0] & 512 | 0) != 0) {
                  var $234 = HEAP[$state + 24 | 0];
                  var $call358 = _crc32($234, $next, $copy);
                  HEAP[$state + 24 | 0] = $call358;
                }
                var $sub361 = $have - $copy | 0;
                $have = $sub361;
                var $add_ptr362 = $next + $copy | 0;
                $next = $add_ptr362;
                var $length363 = $state + 64 | 0;
                var $sub364 = HEAP[$length363] - $copy | 0;
                HEAP[$length363] = $sub364;
              }
              if ((HEAP[$state + 64 | 0] | 0) != 0) {
                __label__ = 322;
                break $for_cond$12;
              }
            }
            HEAP[$state + 64 | 0] = 0;
            HEAP[$state | 0] = 6;
            __label__ = 90;
            break;
          } else if (__label__ == 227) {
            var $cmp1179 = $have >>> 0 >= 6;
            do {
              if ($cmp1179) {
                if (!($left >>> 0 >= 258)) {
                  break;
                }
                HEAP[$strm_addr + 12 | 0] = $put;
                HEAP[$strm_addr + 16 | 0] = $left;
                HEAP[$strm_addr | 0] = $next;
                HEAP[$strm_addr + 4 | 0] = $have;
                HEAP[$state + 56 | 0] = $hold;
                HEAP[$state + 60 | 0] = $bits;
                _inflate_fast($strm_addr, $out);
                $put = HEAP[$strm_addr + 12 | 0];
                $left = HEAP[$strm_addr + 16 | 0];
                $next = HEAP[$strm_addr | 0];
                $have = HEAP[$strm_addr + 4 | 0];
                $hold = HEAP[$state + 56 | 0];
                $bits = HEAP[$state + 60 | 0];
                if ((HEAP[$state | 0] | 0) != 11) {
                  continue $for_cond$12;
                }
                HEAP[$state + 7108 | 0] = -1;
                continue $for_cond$12;
              }
            } while (0);
            HEAP[$state + 7108 | 0] = 0;
            while (1) {
              var $728 = (((1 << HEAP[$state + 84 | 0]) - 1 & $hold) << 2) + HEAP[$state + 76 | 0] | 0;
              HEAP[$29] = HEAP[$728];
              HEAP[$29 + 1] = HEAP[$728 + 1];
              HEAP[$29 + 2] = HEAP[$728 + 2];
              HEAP[$29 + 3] = HEAP[$728 + 3];
              if ((HEAP[$bits1217] & 255) >>> 0 <= $bits >>> 0) {
                break;
              }
              if (($have | 0) == 0) {
                __label__ = 322;
                break $for_cond$12;
              }
              var $dec1228 = $have - 1 | 0;
              $have = $dec1228;
              var $733 = $next;
              var $incdec_ptr1229 = $733 + 1 | 0;
              $next = $incdec_ptr1229;
              var $add1232 = ((HEAP[$733] & 255) << $bits) + $hold | 0;
              $hold = $add1232;
              var $add1233 = $bits + 8 | 0;
              $bits = $add1233;
            }
            var $tobool1238 = (HEAP[$op] & 255 | 0) != 0;
            do {
              if ($tobool1238) {
                if ((HEAP[$op1240] & 255 & 240 | 0) != 0) {
                  break;
                }
                HEAP[$30] = HEAP[$31];
                HEAP[$30 + 1] = HEAP[$31 + 1];
                HEAP[$30 + 2] = HEAP[$31 + 2];
                HEAP[$30 + 3] = HEAP[$31 + 3];
                while (1) {
                  var $747 = ((((1 << (HEAP[$op1251] & 255) + (HEAP[$bits1249] & 255)) - 1 & $hold) >>> ((HEAP[$bits1257] & 255) >>> 0)) + (HEAP[$val1247] & 65535) << 2) + HEAP[$state + 76 | 0] | 0;
                  HEAP[$32] = HEAP[$747];
                  HEAP[$32 + 1] = HEAP[$747 + 1];
                  HEAP[$32 + 2] = HEAP[$747 + 2];
                  HEAP[$32 + 3] = HEAP[$747 + 3];
                  if (((HEAP[$bits1265] & 255) + (HEAP[$bits1263] & 255) | 0) >>> 0 <= $bits >>> 0) {
                    break;
                  }
                  if (($have | 0) == 0) {
                    __label__ = 322;
                    break $for_cond$12;
                  }
                  var $dec1277 = $have - 1 | 0;
                  $have = $dec1277;
                  var $753 = $next;
                  var $incdec_ptr1278 = $753 + 1 | 0;
                  $next = $incdec_ptr1278;
                  var $add1281 = ((HEAP[$753] & 255) << $bits) + $hold | 0;
                  $hold = $add1281;
                  var $add1282 = $bits + 8 | 0;
                  $bits = $add1282;
                }
                var $shr1289 = $hold >>> ((HEAP[$bits1287] & 255) >>> 0);
                $hold = $shr1289;
                var $sub1292 = $bits - (HEAP[$bits1290] & 255) | 0;
                $bits = $sub1292;
                var $back1297 = $state + 7108 | 0;
                var $add1298 = HEAP[$back1297] + (HEAP[$bits1295] & 255) | 0;
                HEAP[$back1297] = $add1298;
              }
            } while (0);
            var $shr1303 = $hold >>> ((HEAP[$bits1301] & 255) >>> 0);
            $hold = $shr1303;
            var $sub1306 = $bits - (HEAP[$bits1304] & 255) | 0;
            $bits = $sub1306;
            var $back1311 = $state + 7108 | 0;
            var $add1312 = HEAP[$back1311] + (HEAP[$bits1309] & 255) | 0;
            HEAP[$back1311] = $add1312;
            var $conv1314 = HEAP[$val1313] & 65535;
            HEAP[$state + 64 | 0] = $conv1314;
            if ((HEAP[$op1316] & 255 | 0) == 0) {
              HEAP[$state | 0] = 25;
              continue $for_cond$12;
            }
            if ((HEAP[$op1323] & 255 & 32 | 0) != 0) {
              HEAP[$state + 7108 | 0] = -1;
              HEAP[$state | 0] = 11;
              continue $for_cond$12;
            }
            if ((HEAP[$op1331] & 255 & 64 | 0) != 0) {
              HEAP[$strm_addr + 24 | 0] = STRING_TABLE.__str271 | 0;
              HEAP[$state | 0] = 29;
              continue $for_cond$12;
            }
            var $and1341 = HEAP[$op1339] & 255 & 15;
            HEAP[$state + 72 | 0] = $and1341;
            HEAP[$state | 0] = 21;
            __label__ = 249;
            break;
          }
        } while (0);
        do {
          if (__label__ == 90) {
            var $tobool376 = (HEAP[$state + 16 | 0] & 2048 | 0) != 0;
            do {
              if ($tobool376) {
                if (($have | 0) == 0) {
                  __label__ = 322;
                  break $for_cond$12;
                }
                $copy = 0;
                while (1) {
                  var $252 = $copy;
                  var $inc = $252 + 1 | 0;
                  $copy = $inc;
                  var $conv384 = HEAP[$next + $252 | 0] & 255;
                  $len = $conv384;
                  if ((HEAP[$state + 32 | 0] | 0) != 0) {
                    var $cmp390 = (HEAP[HEAP[$state + 32 | 0] + 28 | 0] | 0) != 0;
                    do {
                      if ($cmp390) {
                        if (HEAP[$state + 64 | 0] >>> 0 >= HEAP[HEAP[$state + 32 | 0] + 32 | 0] >>> 0) {
                          break;
                        }
                        var $length399 = $state + 64 | 0;
                        var $267 = HEAP[$length399];
                        var $inc400 = $267 + 1 | 0;
                        HEAP[$length399] = $inc400;
                        var $arrayidx403 = HEAP[HEAP[$state + 32 | 0] + 28 | 0] + $267 | 0;
                        HEAP[$arrayidx403] = $len & 255;
                      }
                    } while (0);
                    var $271 = $len;
                  } else {
                    var $271 = $conv384;
                  }
                  var $271;
                  if (($271 | 0) == 0) {
                    break;
                  }
                  if ($copy >>> 0 >= $have >>> 0) {
                    break;
                  }
                }
                if ((HEAP[$state + 16 | 0] & 512 | 0) != 0) {
                  var $277 = HEAP[$state + 24 | 0];
                  var $call414 = _crc32($277, $next, $copy);
                  HEAP[$state + 24 | 0] = $call414;
                }
                var $sub417 = $have - $copy | 0;
                $have = $sub417;
                var $add_ptr418 = $next + $copy | 0;
                $next = $add_ptr418;
                if (($len | 0) != 0) {
                  __label__ = 322;
                  break $for_cond$12;
                }
              } else {
                if ((HEAP[$state + 32 | 0] | 0) == 0) {
                  break;
                }
                var $name428 = HEAP[$state + 32 | 0] + 28 | 0;
                HEAP[$name428] = 0;
              }
            } while (0);
            HEAP[$state + 64 | 0] = 0;
            HEAP[$state | 0] = 7;
            __label__ = 106;
            break;
          } else if (__label__ == 249) {
            if ((HEAP[$state + 72 | 0] | 0) != 0) {
              while (1) {
                if ($bits >>> 0 >= HEAP[$state + 72 | 0] >>> 0) {
                  break;
                }
                if (($have | 0) == 0) {
                  __label__ = 322;
                  break $for_cond$12;
                }
                var $dec1359 = $have - 1 | 0;
                $have = $dec1359;
                var $792 = $next;
                var $incdec_ptr1360 = $792 + 1 | 0;
                $next = $incdec_ptr1360;
                var $add1363 = ((HEAP[$792] & 255) << $bits) + $hold | 0;
                $hold = $add1363;
                var $add1364 = $bits + 8 | 0;
                $bits = $add1364;
              }
              var $length1374 = $state + 64 | 0;
              var $add1375 = ((1 << HEAP[$state + 72 | 0]) - 1 & $hold) + HEAP[$length1374] | 0;
              HEAP[$length1374] = $add1375;
              var $shr1378 = $hold >>> (HEAP[$state + 72 | 0] >>> 0);
              $hold = $shr1378;
              var $sub1380 = $bits - HEAP[$state + 72 | 0] | 0;
              $bits = $sub1380;
              var $back1384 = $state + 7108 | 0;
              var $add1385 = HEAP[$back1384] + HEAP[$state + 72 | 0] | 0;
              HEAP[$back1384] = $add1385;
            }
            var $813 = HEAP[$state + 64 | 0];
            HEAP[$state + 7112 | 0] = $813;
            HEAP[$state | 0] = 22;
            __label__ = 255;
            break;
          }
        } while (0);
        do {
          if (__label__ == 106) {
            var $tobool436 = (HEAP[$state + 16 | 0] & 4096 | 0) != 0;
            do {
              if ($tobool436) {
                if (($have | 0) == 0) {
                  __label__ = 322;
                  break $for_cond$12;
                }
                $copy = 0;
                while (1) {
                  var $295 = $copy;
                  var $inc443 = $295 + 1 | 0;
                  $copy = $inc443;
                  var $conv445 = HEAP[$next + $295 | 0] & 255;
                  $len = $conv445;
                  if ((HEAP[$state + 32 | 0] | 0) != 0) {
                    var $cmp451 = (HEAP[HEAP[$state + 32 | 0] + 36 | 0] | 0) != 0;
                    do {
                      if ($cmp451) {
                        if (HEAP[$state + 64 | 0] >>> 0 >= HEAP[HEAP[$state + 32 | 0] + 40 | 0] >>> 0) {
                          break;
                        }
                        var $length460 = $state + 64 | 0;
                        var $310 = HEAP[$length460];
                        var $inc461 = $310 + 1 | 0;
                        HEAP[$length460] = $inc461;
                        var $arrayidx464 = HEAP[HEAP[$state + 32 | 0] + 36 | 0] + $310 | 0;
                        HEAP[$arrayidx464] = $len & 255;
                      }
                    } while (0);
                    var $314 = $len;
                  } else {
                    var $314 = $conv445;
                  }
                  var $314;
                  if (($314 | 0) == 0) {
                    break;
                  }
                  if ($copy >>> 0 >= $have >>> 0) {
                    break;
                  }
                }
                if ((HEAP[$state + 16 | 0] & 512 | 0) != 0) {
                  var $320 = HEAP[$state + 24 | 0];
                  var $call478 = _crc32($320, $next, $copy);
                  HEAP[$state + 24 | 0] = $call478;
                }
                var $sub481 = $have - $copy | 0;
                $have = $sub481;
                var $add_ptr482 = $next + $copy | 0;
                $next = $add_ptr482;
                if (($len | 0) != 0) {
                  __label__ = 322;
                  break $for_cond$12;
                }
              } else {
                if ((HEAP[$state + 32 | 0] | 0) == 0) {
                  break;
                }
                var $comment492 = HEAP[$state + 32 | 0] + 36 | 0;
                HEAP[$comment492] = 0;
              }
            } while (0);
            HEAP[$state | 0] = 8;
            __label__ = 122;
            break;
          } else if (__label__ == 255) {
            while (1) {
              var $821 = (((1 << HEAP[$state + 88 | 0]) - 1 & $hold) << 2) + HEAP[$state + 80 | 0] | 0;
              HEAP[$34] = HEAP[$821];
              HEAP[$34 + 1] = HEAP[$821 + 1];
              HEAP[$34 + 2] = HEAP[$821 + 2];
              HEAP[$34 + 3] = HEAP[$821 + 3];
              if ((HEAP[$bits1397] & 255) >>> 0 <= $bits >>> 0) {
                break;
              }
              if (($have | 0) == 0) {
                __label__ = 322;
                break $for_cond$12;
              }
              var $dec1408 = $have - 1 | 0;
              $have = $dec1408;
              var $826 = $next;
              var $incdec_ptr1409 = $826 + 1 | 0;
              $next = $incdec_ptr1409;
              var $add1412 = ((HEAP[$826] & 255) << $bits) + $hold | 0;
              $hold = $add1412;
              var $add1413 = $bits + 8 | 0;
              $bits = $add1413;
            }
            if ((HEAP[$op1417] & 255 & 240 | 0) == 0) {
              HEAP[$35] = HEAP[$36];
              HEAP[$35 + 1] = HEAP[$36 + 1];
              HEAP[$35 + 2] = HEAP[$36 + 2];
              HEAP[$35 + 3] = HEAP[$36 + 3];
              while (1) {
                var $839 = ((((1 << (HEAP[$op1428] & 255) + (HEAP[$bits1426] & 255)) - 1 & $hold) >>> ((HEAP[$bits1434] & 255) >>> 0)) + (HEAP[$val1424] & 65535) << 2) + HEAP[$state + 80 | 0] | 0;
                HEAP[$37] = HEAP[$839];
                HEAP[$37 + 1] = HEAP[$839 + 1];
                HEAP[$37 + 2] = HEAP[$839 + 2];
                HEAP[$37 + 3] = HEAP[$839 + 3];
                if (((HEAP[$bits1442] & 255) + (HEAP[$bits1440] & 255) | 0) >>> 0 <= $bits >>> 0) {
                  break;
                }
                if (($have | 0) == 0) {
                  __label__ = 322;
                  break $for_cond$12;
                }
                var $dec1454 = $have - 1 | 0;
                $have = $dec1454;
                var $845 = $next;
                var $incdec_ptr1455 = $845 + 1 | 0;
                $next = $incdec_ptr1455;
                var $add1458 = ((HEAP[$845] & 255) << $bits) + $hold | 0;
                $hold = $add1458;
                var $add1459 = $bits + 8 | 0;
                $bits = $add1459;
              }
              var $shr1466 = $hold >>> ((HEAP[$bits1464] & 255) >>> 0);
              $hold = $shr1466;
              var $sub1469 = $bits - (HEAP[$bits1467] & 255) | 0;
              $bits = $sub1469;
              var $back1474 = $state + 7108 | 0;
              var $add1475 = HEAP[$back1474] + (HEAP[$bits1472] & 255) | 0;
              HEAP[$back1474] = $add1475;
            }
            var $shr1480 = $hold >>> ((HEAP[$bits1478] & 255) >>> 0);
            $hold = $shr1480;
            var $sub1483 = $bits - (HEAP[$bits1481] & 255) | 0;
            $bits = $sub1483;
            var $back1488 = $state + 7108 | 0;
            var $add1489 = HEAP[$back1488] + (HEAP[$bits1486] & 255) | 0;
            HEAP[$back1488] = $add1489;
            if ((HEAP[$op1490] & 255 & 64 | 0) != 0) {
              HEAP[$strm_addr + 24 | 0] = STRING_TABLE.__str170 | 0;
              HEAP[$state | 0] = 29;
              continue $for_cond$12;
            }
            var $conv1499 = HEAP[$val1498] & 65535;
            HEAP[$state + 68 | 0] = $conv1499;
            var $and1502 = HEAP[$op1500] & 255 & 15;
            HEAP[$state + 72 | 0] = $and1502;
            HEAP[$state | 0] = 23;
            __label__ = 267;
            break;
          }
        } while (0);
        if (__label__ == 122) {
          if ((HEAP[$state + 16 | 0] & 512 | 0) != 0) {
            var $336 = $bits;
            while (1) {
              var $336;
              if ($336 >>> 0 >= 16) {
                break;
              }
              if (($have | 0) == 0) {
                __label__ = 322;
                break $for_cond$12;
              }
              var $dec511 = $have - 1 | 0;
              $have = $dec511;
              var $339 = $next;
              var $incdec_ptr512 = $339 + 1 | 0;
              $next = $incdec_ptr512;
              var $add515 = ((HEAP[$339] & 255) << $bits) + $hold | 0;
              $hold = $add515;
              var $add516 = $bits + 8 | 0;
              $bits = $add516;
              var $336 = $add516;
            }
            if (($hold | 0) != (HEAP[$state + 24 | 0] & 65535 | 0)) {
              HEAP[$strm_addr + 24 | 0] = STRING_TABLE.__str519 | 0;
              HEAP[$state | 0] = 29;
              continue;
            }
            $hold = 0;
            $bits = 0;
          }
          if ((HEAP[$state + 32 | 0] | 0) != 0) {
            var $and540 = HEAP[$state + 16 | 0] >> 9 & 1;
            var $hcrc = HEAP[$state + 32 | 0] + 44 | 0;
            HEAP[$hcrc] = $and540;
            var $done543 = HEAP[$state + 32 | 0] + 48 | 0;
            HEAP[$done543] = 1;
          }
          var $call545 = _crc32(0, 0, 0);
          HEAP[$state + 24 | 0] = $call545;
          HEAP[$strm_addr + 48 | 0] = $call545;
          HEAP[$state | 0] = 11;
          continue;
        } else if (__label__ == 267) {
          if ((HEAP[$state + 72 | 0] | 0) != 0) {
            while (1) {
              if ($bits >>> 0 >= HEAP[$state + 72 | 0] >>> 0) {
                break;
              }
              if (($have | 0) == 0) {
                __label__ = 322;
                break $for_cond$12;
              }
              var $dec1520 = $have - 1 | 0;
              $have = $dec1520;
              var $879 = $next;
              var $incdec_ptr1521 = $879 + 1 | 0;
              $next = $incdec_ptr1521;
              var $add1524 = ((HEAP[$879] & 255) << $bits) + $hold | 0;
              $hold = $add1524;
              var $add1525 = $bits + 8 | 0;
              $bits = $add1525;
            }
            var $offset1535 = $state + 68 | 0;
            var $add1536 = ((1 << HEAP[$state + 72 | 0]) - 1 & $hold) + HEAP[$offset1535] | 0;
            HEAP[$offset1535] = $add1536;
            var $shr1539 = $hold >>> (HEAP[$state + 72 | 0] >>> 0);
            $hold = $shr1539;
            var $sub1541 = $bits - HEAP[$state + 72 | 0] | 0;
            $bits = $sub1541;
            var $back1545 = $state + 7108 | 0;
            var $add1546 = HEAP[$back1545] + HEAP[$state + 72 | 0] | 0;
            HEAP[$back1545] = $add1546;
          }
          HEAP[$state | 0] = 24;
        }
        if (($left | 0) == 0) {
          __label__ = 322;
          break;
        }
        $copy = $out - $left | 0;
        var $cmp1556 = HEAP[$state + 68 | 0] >>> 0 > $copy >>> 0;
        do {
          if ($cmp1556) {
            var $sub1560 = HEAP[$state + 68 | 0] - $copy | 0;
            $copy = $sub1560;
            var $cmp1561 = $copy >>> 0 > HEAP[$state + 44 | 0] >>> 0;
            do {
              if ($cmp1561) {
                if ((HEAP[$state + 7104 | 0] | 0) == 0) {
                  break;
                }
                HEAP[$strm_addr + 24 | 0] = STRING_TABLE.__str69 | 0;
                HEAP[$state | 0] = 29;
                continue $for_cond$12;
              }
            } while (0);
            var $919 = $state;
            if ($copy >>> 0 > HEAP[$state + 48 | 0] >>> 0) {
              var $sub1574 = $copy - HEAP[$919 + 48 | 0] | 0;
              $copy = $sub1574;
              $from = HEAP[$state + 52 | 0] + (HEAP[$state + 40 | 0] - $copy) | 0;
            } else {
              $from = HEAP[$919 + 52 | 0] + (HEAP[$state + 48 | 0] - $copy) | 0;
            }
            if ($copy >>> 0 <= HEAP[$state + 64 | 0] >>> 0) {
              break;
            }
            $copy = HEAP[$state + 64 | 0];
          } else {
            $from = $put + -HEAP[$state + 68 | 0] | 0;
            $copy = HEAP[$state + 64 | 0];
          }
        } while (0);
        if ($copy >>> 0 > $left >>> 0) {
          $copy = $left;
        }
        var $sub1598 = $left - $copy | 0;
        $left = $sub1598;
        var $length1599 = $state + 64 | 0;
        var $sub1600 = HEAP[$length1599] - $copy | 0;
        HEAP[$length1599] = $sub1600;
        while (1) {
          var $949 = $from;
          var $incdec_ptr1602 = $949 + 1 | 0;
          $from = $incdec_ptr1602;
          var $950 = HEAP[$949];
          var $951 = $put;
          var $incdec_ptr1603 = $951 + 1 | 0;
          $put = $incdec_ptr1603;
          HEAP[$951] = $950;
          var $dec1605 = $copy - 1 | 0;
          $copy = $dec1605;
          if (($dec1605 | 0) == 0) {
            break;
          }
        }
        if ((HEAP[$state + 64 | 0] | 0) != 0) {
          continue;
        }
        HEAP[$state | 0] = 20;
      }
      do {
        if (__label__ == 317) {
          HEAP[$state | 0] = 28;
          __label__ = 318;
          break;
        }
      } while (0);
      if (__label__ == 318) {
        $ret = 1;
      }
      HEAP[$strm_addr + 12 | 0] = $put;
      HEAP[$strm_addr + 16 | 0] = $left;
      HEAP[$strm_addr | 0] = $next;
      HEAP[$strm_addr + 4 | 0] = $have;
      HEAP[$state + 56 | 0] = $hold;
      HEAP[$state + 60 | 0] = $bits;
      var $tobool1755 = (HEAP[$state + 40 | 0] | 0) != 0;
      do {
        if ($tobool1755) {
          __label__ = 325;
        } else {
          if (HEAP[$state | 0] >>> 0 >= 26) {
            __label__ = 327;
            break;
          }
          if (($out | 0) != (HEAP[$strm_addr + 16 | 0] | 0)) {
            __label__ = 325;
            break;
          }
          __label__ = 327;
          break;
        }
      } while (0);
      do {
        if (__label__ == 325) {
          var $call1765 = _updatewindow($strm_addr, $out);
          if (($call1765 | 0) == 0) {
            break;
          }
          HEAP[$state | 0] = 30;
          $retval = -4;
          __label__ = 341;
          break $if_then$$lor_lhs_false$2;
        }
      } while (0);
      var $sub1772 = $in - HEAP[$strm_addr + 4 | 0] | 0;
      $in = $sub1772;
      var $sub1774 = $out - HEAP[$strm_addr + 16 | 0] | 0;
      $out = $sub1774;
      var $total_in = $strm_addr + 8 | 0;
      var $add1775 = HEAP[$total_in] + $in | 0;
      HEAP[$total_in] = $add1775;
      var $total_out1776 = $strm_addr + 20 | 0;
      var $add1777 = HEAP[$total_out1776] + $out | 0;
      HEAP[$total_out1776] = $add1777;
      var $total1778 = $state + 28 | 0;
      var $add1779 = HEAP[$total1778] + $out | 0;
      HEAP[$total1778] = $add1779;
      var $tobool1781 = (HEAP[$state + 8 | 0] | 0) != 0;
      do {
        if ($tobool1781) {
          if (($out | 0) == 0) {
            break;
          }
          var $1063 = HEAP[$state + 24 | 0];
          var $add_ptr1791 = HEAP[$strm_addr + 12 | 0] + -$out | 0;
          var $1067 = $out;
          if ((HEAP[$state + 16 | 0] | 0) != 0) {
            var $call1792 = _crc32($1063, $add_ptr1791, $1067);
            var $cond1800 = $call1792;
          } else {
            var $call1798 = _adler32($1063, $add_ptr1791, $1067);
            var $cond1800 = $call1798;
          }
          var $cond1800;
          HEAP[$state + 24 | 0] = $cond1800;
          HEAP[$strm_addr + 48 | 0] = $cond1800;
        }
      } while (0);
      var $cond1807 = (HEAP[$state + 4 | 0] | 0) != 0 ? 64 : 0;
      var $cond1812 = (HEAP[$state | 0] | 0) == 11 ? 128 : 0;
      if ((HEAP[$state | 0] | 0) == 19) {
        var $1080 = 1;
      } else {
        var $1080 = (HEAP[$state | 0] | 0) == 14;
      }
      var $1080;
      var $cond1820 = $1080 ? 256 : 0;
      var $add1821 = $cond1807 + HEAP[$state + 60 | 0] + $cond1812 + $cond1820 | 0;
      HEAP[$strm_addr + 44 | 0] = $add1821;
      var $cmp1822 = ($in | 0) == 0;
      do {
        if ($cmp1822) {
          if (($out | 0) == 0) {
            __label__ = 338;
            break;
          }
          __label__ = 337;
          break;
        } else {
          __label__ = 337;
        }
      } while (0);
      do {
        if (__label__ == 337) {
          if (($flush_addr | 0) == 4) {
            __label__ = 338;
            break;
          }
          __label__ = 340;
          break;
        }
      } while (0);
      do {
        if (__label__ == 338) {
          if (($ret | 0) != 0) {
            break;
          }
          $ret = -5;
        }
      } while (0);
      $retval = $ret;
      __label__ = 341;
      break;
    }
    __label__ = 5;
  } while (0);
  if (__label__ == 5) {
    $retval = -2;
  }
  STACKTOP = __stackBase__;
  return $retval;
  return null;
}

_inflate["X"] = 1;

function _fixedtables($state) {
  var $state_addr;
  $state_addr = $state;
  HEAP[$state_addr + 76 | 0] = _fixedtables_lenfix | 0;
  HEAP[$state_addr + 84 | 0] = 9;
  HEAP[$state_addr + 80 | 0] = _fixedtables_distfix | 0;
  HEAP[$state_addr + 88 | 0] = 5;
  return;
  return;
}

function _init_block($s) {
  var $s_addr;
  var $n;
  $s_addr = $s;
  $n = 0;
  while (1) {
    HEAP[($n << 2) + $s_addr + 148 | 0] = 0;
    var $inc = $n + 1 | 0;
    $n = $inc;
    if (($inc | 0) >= 286) {
      break;
    }
  }
  $n = 0;
  while (1) {
    HEAP[($n << 2) + $s_addr + 2440 | 0] = 0;
    var $inc8 = $n + 1 | 0;
    $n = $inc8;
    if (($inc8 | 0) >= 30) {
      break;
    }
  }
  $n = 0;
  while (1) {
    HEAP[($n << 2) + $s_addr + 2684 | 0] = 0;
    var $inc17 = $n + 1 | 0;
    $n = $inc17;
    if (($inc17 | 0) >= 19) {
      break;
    }
  }
  HEAP[$s_addr + 1172 | 0] = 1;
  HEAP[$s_addr + 5804 | 0] = 0;
  HEAP[$s_addr + 5800 | 0] = 0;
  HEAP[$s_addr + 5808 | 0] = 0;
  HEAP[$s_addr + 5792 | 0] = 0;
  return;
  return;
}

_init_block["X"] = 1;

function _updatewindow($strm, $out) {
  var __label__;
  var $retval;
  var $strm_addr;
  var $out_addr;
  var $state;
  var $copy;
  var $dist;
  $strm_addr = $strm;
  $out_addr = $out;
  $state = HEAP[$strm_addr + 28 | 0];
  var $cmp = (HEAP[$state + 52 | 0] | 0) == 0;
  do {
    if ($cmp) {
      var $6 = HEAP[$strm_addr + 32 | 0];
      var $8 = HEAP[$strm_addr + 40 | 0];
      var $shl = 1 << HEAP[$state + 36 | 0];
      var $call = FUNCTION_TABLE[$6]($8, $shl, 1);
      HEAP[$state + 52 | 0] = $call;
      if ((HEAP[$state + 52 | 0] | 0) != 0) {
        __label__ = 3;
        break;
      }
      $retval = 1;
      __label__ = 16;
      break;
    }
    __label__ = 3;
  } while (0);
  if (__label__ == 3) {
    if ((HEAP[$state + 40 | 0] | 0) == 0) {
      var $shl10 = 1 << HEAP[$state + 36 | 0];
      HEAP[$state + 40 | 0] = $shl10;
      HEAP[$state + 48 | 0] = 0;
      HEAP[$state + 44 | 0] = 0;
    }
    $copy = $out_addr - HEAP[$strm_addr + 16 | 0] | 0;
    var $cmp14 = $copy >>> 0 >= HEAP[$state + 40 | 0] >>> 0;
    var $27 = $state;
    do {
      if ($cmp14) {
        var $28 = HEAP[$27 + 52 | 0];
        var $add_ptr = HEAP[$strm_addr + 12 | 0] + -HEAP[$state + 40 | 0] | 0;
        var $34 = HEAP[$state + 40 | 0];
        for (var $$src = $add_ptr, $$dest = $28, $$stop = $$src + $34; $$src < $$stop; $$src++, $$dest++) {
          HEAP[$$dest] = HEAP[$$src];
        }
        HEAP[$state + 48 | 0] = 0;
        var $37 = HEAP[$state + 40 | 0];
        HEAP[$state + 44 | 0] = $37;
      } else {
        $dist = HEAP[$27 + 40 | 0] - HEAP[$state + 48 | 0] | 0;
        if ($dist >>> 0 > $copy >>> 0) {
          $dist = $copy;
        }
        var $add_ptr30 = HEAP[$state + 52 | 0] + HEAP[$state + 48 | 0] | 0;
        var $add_ptr33 = HEAP[$strm_addr + 12 | 0] + -$copy | 0;
        var $52 = $dist;
        for (var $$src = $add_ptr33, $$dest = $add_ptr30, $$stop = $$src + $52; $$src < $$stop; $$src++, $$dest++) {
          HEAP[$$dest] = HEAP[$$src];
        }
        var $sub34 = $copy - $dist | 0;
        $copy = $sub34;
        if (($sub34 | 0) != 0) {
          var $56 = HEAP[$state + 52 | 0];
          var $add_ptr39 = HEAP[$strm_addr + 12 | 0] + -$copy | 0;
          var $60 = $copy;
          for (var $$src = $add_ptr39, $$dest = $56, $$stop = $$src + $60; $$src < $$stop; $$src++, $$dest++) {
            HEAP[$$dest] = HEAP[$$src];
          }
          HEAP[$state + 48 | 0] = $copy;
          var $64 = HEAP[$state + 40 | 0];
          HEAP[$state + 44 | 0] = $64;
        } else {
          var $wnext44 = $state + 48 | 0;
          var $add = HEAP[$wnext44] + $dist | 0;
          HEAP[$wnext44] = $add;
          if ((HEAP[$state + 48 | 0] | 0) == (HEAP[$state + 40 | 0] | 0)) {
            HEAP[$state + 48 | 0] = 0;
          }
          if (HEAP[$state + 44 | 0] >>> 0 >= HEAP[$state + 40 | 0] >>> 0) {
            break;
          }
          var $whave55 = $state + 44 | 0;
          var $add56 = HEAP[$whave55] + $dist | 0;
          HEAP[$whave55] = $add56;
        }
      }
    } while (0);
    $retval = 0;
  }
  return $retval;
  return null;
}

_updatewindow["X"] = 1;

function _inflateEnd($strm) {
  var __label__;
  var $retval;
  var $strm_addr;
  var $state;
  $strm_addr = $strm;
  var $cmp = ($strm_addr | 0) == 0;
  do {
    if (!$cmp) {
      if ((HEAP[$strm_addr + 28 | 0] | 0) == 0) {
        __label__ = 3;
        break;
      }
      if ((HEAP[$strm_addr + 36 | 0] | 0) == 0) {
        __label__ = 3;
        break;
      }
      $state = HEAP[$strm_addr + 28 | 0];
      if ((HEAP[$state + 52 | 0] | 0) != 0) {
        var $11 = HEAP[$strm_addr + 36 | 0];
        var $13 = HEAP[$strm_addr + 40 | 0];
        var $15 = HEAP[$state + 52 | 0];
        FUNCTION_TABLE[$11]($13, $15);
      }
      var $17 = HEAP[$strm_addr + 36 | 0];
      var $19 = HEAP[$strm_addr + 40 | 0];
      var $22 = HEAP[$strm_addr + 28 | 0];
      FUNCTION_TABLE[$17]($19, $22);
      HEAP[$strm_addr + 28 | 0] = 0;
      $retval = 0;
      __label__ = 7;
      break;
    }
    __label__ = 3;
  } while (0);
  if (__label__ == 3) {
    $retval = -2;
  }
  return;
  return;
}

_inflateEnd["X"] = 1;

function __tr_init($s) {
  var $s_addr;
  $s_addr = $s;
  HEAP[$s_addr + 2840 | 0] = $s_addr + 148 | 0;
  HEAP[$s_addr + 2848 | 0] = _static_l_desc;
  HEAP[$s_addr + 2852 | 0] = $s_addr + 2440 | 0;
  HEAP[$s_addr + 2860 | 0] = _static_d_desc;
  HEAP[$s_addr + 2864 | 0] = $s_addr + 2684 | 0;
  HEAP[$s_addr + 2872 | 0] = _static_bl_desc;
  HEAP[$s_addr + 5816 | 0] = 0;
  HEAP[$s_addr + 5820 | 0] = 0;
  HEAP[$s_addr + 5812 | 0] = 8;
  _init_block($s_addr);
  return;
  return;
}

function __tr_stored_block($s, $buf, $stored_len, $last) {
  var $s_addr;
  var $buf_addr;
  var $stored_len_addr;
  var $last_addr;
  var $len;
  var $val;
  $s_addr = $s;
  $buf_addr = $buf;
  $stored_len_addr = $stored_len;
  $last_addr = $last;
  $len = 3;
  var $3 = $last_addr;
  if ((HEAP[$s_addr + 5820 | 0] | 0) > (16 - $len | 0)) {
    $val = $3;
    var $bi_buf = $s_addr + 5816 | 0;
    var $conv4 = (HEAP[$bi_buf] & 65535 | ($val & 65535 & 65535) << HEAP[$s_addr + 5820 | 0]) & 65535;
    HEAP[$bi_buf] = $conv4;
    var $conv7 = HEAP[$s_addr + 5816 | 0] & 65535 & 255 & 255;
    var $pending = $s_addr + 20 | 0;
    var $12 = HEAP[$pending];
    var $inc = $12 + 1 | 0;
    HEAP[$pending] = $inc;
    var $arrayidx = HEAP[$s_addr + 8 | 0] + $12 | 0;
    HEAP[$arrayidx] = $conv7;
    var $conv10 = (HEAP[$s_addr + 5816 | 0] & 65535) >> 8 & 255;
    var $pending11 = $s_addr + 20 | 0;
    var $18 = HEAP[$pending11];
    var $inc12 = $18 + 1 | 0;
    HEAP[$pending11] = $inc12;
    var $arrayidx14 = HEAP[$s_addr + 8 | 0] + $18 | 0;
    HEAP[$arrayidx14] = $conv10;
    var $conv20 = ($val & 65535 & 65535) >> 16 - HEAP[$s_addr + 5820 | 0] & 65535;
    HEAP[$s_addr + 5816 | 0] = $conv20;
    var $bi_valid23 = $s_addr + 5820 | 0;
    var $add24 = $len - 16 + HEAP[$bi_valid23] | 0;
    HEAP[$bi_valid23] = $add24;
  } else {
    var $bi_buf30 = $s_addr + 5816 | 0;
    var $conv33 = (HEAP[$bi_buf30] & 65535 | ($3 & 65535 & 65535) << HEAP[$s_addr + 5820 | 0]) & 65535;
    HEAP[$bi_buf30] = $conv33;
    var $bi_valid34 = $s_addr + 5820 | 0;
    var $add35 = HEAP[$bi_valid34] + $len | 0;
    HEAP[$bi_valid34] = $add35;
  }
  _copy_block($s_addr, $buf_addr, $stored_len_addr);
  return;
  return;
}

__tr_stored_block["X"] = 1;

function _copy_block($s, $buf, $len) {
  var $s_addr;
  var $buf_addr;
  var $len_addr;
  var $header_addr;
  $s_addr = $s;
  $buf_addr = $buf;
  $len_addr = $len;
  $header_addr = 1;
  _bi_windup($s_addr);
  HEAP[$s_addr + 5812 | 0] = 8;
  if (($header_addr | 0) != 0) {
    var $pending = $s_addr + 20 | 0;
    var $5 = HEAP[$pending];
    var $inc = $5 + 1 | 0;
    HEAP[$pending] = $inc;
    var $arrayidx = HEAP[$s_addr + 8 | 0] + $5 | 0;
    HEAP[$arrayidx] = $len_addr & 65535 & 65535 & 255 & 255;
    var $pending6 = $s_addr + 20 | 0;
    var $10 = HEAP[$pending6];
    var $inc7 = $10 + 1 | 0;
    HEAP[$pending6] = $inc7;
    var $arrayidx9 = HEAP[$s_addr + 8 | 0] + $10 | 0;
    HEAP[$arrayidx9] = ($len_addr & 65535 & 65535) >> 8 & 255;
    var $pending14 = $s_addr + 20 | 0;
    var $15 = HEAP[$pending14];
    var $inc15 = $15 + 1 | 0;
    HEAP[$pending14] = $inc15;
    var $arrayidx17 = HEAP[$s_addr + 8 | 0] + $15 | 0;
    HEAP[$arrayidx17] = ($len_addr ^ -1) & 65535 & 65535 & 255 & 255;
    var $pending23 = $s_addr + 20 | 0;
    var $20 = HEAP[$pending23];
    var $inc24 = $20 + 1 | 0;
    HEAP[$pending23] = $inc24;
    var $arrayidx26 = HEAP[$s_addr + 8 | 0] + $20 | 0;
    HEAP[$arrayidx26] = (($len_addr ^ -1) & 65535 & 65535) >> 8 & 255;
  }
  var $23 = $len_addr;
  var $dec1 = $23 - 1 | 0;
  $len_addr = $dec1;
  var $tobool272 = ($23 | 0) != 0;
  $while_body$$while_end$57 : do {
    if ($tobool272) {
      while (1) {
        var $24 = $buf_addr;
        var $incdec_ptr = $24 + 1 | 0;
        $buf_addr = $incdec_ptr;
        var $25 = HEAP[$24];
        var $pending28 = $s_addr + 20 | 0;
        var $27 = HEAP[$pending28];
        var $inc29 = $27 + 1 | 0;
        HEAP[$pending28] = $inc29;
        var $arrayidx31 = HEAP[$s_addr + 8 | 0] + $27 | 0;
        HEAP[$arrayidx31] = $25;
        var $30 = $len_addr;
        var $dec = $30 - 1 | 0;
        $len_addr = $dec;
        if (($30 | 0) == 0) {
          break $while_body$$while_end$57;
        }
      }
    }
  } while (0);
  return;
  return;
}

_copy_block["X"] = 1;

function _bi_flush($s) {
  var $s_addr;
  $s_addr = $s;
  var $cmp = (HEAP[$s_addr + 5820 | 0] | 0) == 16;
  var $2 = $s_addr;
  do {
    if ($cmp) {
      var $conv1 = HEAP[$2 + 5816 | 0] & 65535 & 255 & 255;
      var $pending = $s_addr + 20 | 0;
      var $5 = HEAP[$pending];
      var $inc = $5 + 1 | 0;
      HEAP[$pending] = $inc;
      var $arrayidx = HEAP[$s_addr + 8 | 0] + $5 | 0;
      HEAP[$arrayidx] = $conv1;
      var $conv4 = (HEAP[$s_addr + 5816 | 0] & 65535) >> 8 & 255;
      var $pending5 = $s_addr + 20 | 0;
      var $11 = HEAP[$pending5];
      var $inc6 = $11 + 1 | 0;
      HEAP[$pending5] = $inc6;
      var $arrayidx8 = HEAP[$s_addr + 8 | 0] + $11 | 0;
      HEAP[$arrayidx8] = $conv4;
      HEAP[$s_addr + 5816 | 0] = 0;
      HEAP[$s_addr + 5820 | 0] = 0;
    } else {
      if (!((HEAP[$2 + 5820 | 0] | 0) >= 8)) {
        break;
      }
      var $conv16 = HEAP[$s_addr + 5816 | 0] & 255;
      var $pending17 = $s_addr + 20 | 0;
      var $20 = HEAP[$pending17];
      var $inc18 = $20 + 1 | 0;
      HEAP[$pending17] = $inc18;
      var $arrayidx20 = HEAP[$s_addr + 8 | 0] + $20 | 0;
      HEAP[$arrayidx20] = $conv16;
      var $bi_buf21 = $s_addr + 5816 | 0;
      var $conv24 = (HEAP[$bi_buf21] & 65535) >> 8 & 65535;
      HEAP[$bi_buf21] = $conv24;
      var $bi_valid25 = $s_addr + 5820 | 0;
      var $sub = HEAP[$bi_valid25] - 8 | 0;
      HEAP[$bi_valid25] = $sub;
    }
  } while (0);
  return;
  return;
}

_bi_flush["X"] = 1;

function __tr_align($s) {
  var $s_addr;
  var $len;
  var $val;
  var $len32;
  var $val39;
  var $len93;
  var $val99;
  var $len144;
  var $val151;
  $s_addr = $s;
  $len = 3;
  if ((HEAP[$s_addr + 5820 | 0] | 0) > (16 - $len | 0)) {
    $val = 2;
    var $bi_buf = $s_addr + 5816 | 0;
    var $conv4 = (HEAP[$bi_buf] & 65535 | ($val & 65535 & 65535) << HEAP[$s_addr + 5820 | 0]) & 65535;
    HEAP[$bi_buf] = $conv4;
    var $conv7 = HEAP[$s_addr + 5816 | 0] & 65535 & 255 & 255;
    var $pending = $s_addr + 20 | 0;
    var $11 = HEAP[$pending];
    var $inc = $11 + 1 | 0;
    HEAP[$pending] = $inc;
    var $arrayidx = HEAP[$s_addr + 8 | 0] + $11 | 0;
    HEAP[$arrayidx] = $conv7;
    var $conv10 = (HEAP[$s_addr + 5816 | 0] & 65535) >> 8 & 255;
    var $pending11 = $s_addr + 20 | 0;
    var $17 = HEAP[$pending11];
    var $inc12 = $17 + 1 | 0;
    HEAP[$pending11] = $inc12;
    var $arrayidx14 = HEAP[$s_addr + 8 | 0] + $17 | 0;
    HEAP[$arrayidx14] = $conv10;
    var $conv20 = ($val & 65535 & 65535) >> 16 - HEAP[$s_addr + 5820 | 0] & 65535;
    HEAP[$s_addr + 5816 | 0] = $conv20;
    var $bi_valid23 = $s_addr + 5820 | 0;
    var $add = $len - 16 + HEAP[$bi_valid23] | 0;
    HEAP[$bi_valid23] = $add;
  } else {
    var $bi_buf26 = $s_addr + 5816 | 0;
    var $conv29 = (HEAP[$bi_buf26] & 65535 | 2 << HEAP[$s_addr + 5820 | 0]) & 65535;
    HEAP[$bi_buf26] = $conv29;
    var $bi_valid30 = $s_addr + 5820 | 0;
    var $add31 = HEAP[$bi_valid30] + $len | 0;
    HEAP[$bi_valid30] = $add31;
  }
  $len32 = 7;
  if ((HEAP[$s_addr + 5820 | 0] | 0) > (16 - $len32 | 0)) {
    $val39 = 0;
    var $bi_buf45 = $s_addr + 5816 | 0;
    var $conv48 = (HEAP[$bi_buf45] & 65535 | ($val39 & 65535 & 65535) << HEAP[$s_addr + 5820 | 0]) & 65535;
    HEAP[$bi_buf45] = $conv48;
    var $conv52 = HEAP[$s_addr + 5816 | 0] & 65535 & 255 & 255;
    var $pending53 = $s_addr + 20 | 0;
    var $45 = HEAP[$pending53];
    var $inc54 = $45 + 1 | 0;
    HEAP[$pending53] = $inc54;
    var $arrayidx56 = HEAP[$s_addr + 8 | 0] + $45 | 0;
    HEAP[$arrayidx56] = $conv52;
    var $conv60 = (HEAP[$s_addr + 5816 | 0] & 65535) >> 8 & 255;
    var $pending61 = $s_addr + 20 | 0;
    var $51 = HEAP[$pending61];
    var $inc62 = $51 + 1 | 0;
    HEAP[$pending61] = $inc62;
    var $arrayidx64 = HEAP[$s_addr + 8 | 0] + $51 | 0;
    HEAP[$arrayidx64] = $conv60;
    var $conv70 = ($val39 & 65535 & 65535) >> 16 - HEAP[$s_addr + 5820 | 0] & 65535;
    HEAP[$s_addr + 5816 | 0] = $conv70;
    var $bi_valid73 = $s_addr + 5820 | 0;
    var $add74 = $len32 - 16 + HEAP[$bi_valid73] | 0;
    HEAP[$bi_valid73] = $add74;
  } else {
    var $bi_buf79 = $s_addr + 5816 | 0;
    var $conv82 = (HEAP[$bi_buf79] & 65535 | 0 << HEAP[$s_addr + 5820 | 0]) & 65535;
    HEAP[$bi_buf79] = $conv82;
    var $bi_valid83 = $s_addr + 5820 | 0;
    var $add84 = HEAP[$bi_valid83] + $len32 | 0;
    HEAP[$bi_valid83] = $add84;
  }
  _bi_flush($s_addr);
  if ((HEAP[$s_addr + 5812 | 0] + -HEAP[$s_addr + 5820 | 0] + 11 | 0) < 9) {
    $len93 = 3;
    if ((HEAP[$s_addr + 5820 | 0] | 0) > (16 - $len93 | 0)) {
      $val99 = 2;
      var $bi_buf104 = $s_addr + 5816 | 0;
      var $conv107 = (HEAP[$bi_buf104] & 65535 | ($val99 & 65535 & 65535) << HEAP[$s_addr + 5820 | 0]) & 65535;
      HEAP[$bi_buf104] = $conv107;
      var $conv111 = HEAP[$s_addr + 5816 | 0] & 65535 & 255 & 255;
      var $pending112 = $s_addr + 20 | 0;
      var $84 = HEAP[$pending112];
      var $inc113 = $84 + 1 | 0;
      HEAP[$pending112] = $inc113;
      var $arrayidx115 = HEAP[$s_addr + 8 | 0] + $84 | 0;
      HEAP[$arrayidx115] = $conv111;
      var $conv119 = (HEAP[$s_addr + 5816 | 0] & 65535) >> 8 & 255;
      var $pending120 = $s_addr + 20 | 0;
      var $90 = HEAP[$pending120];
      var $inc121 = $90 + 1 | 0;
      HEAP[$pending120] = $inc121;
      var $arrayidx123 = HEAP[$s_addr + 8 | 0] + $90 | 0;
      HEAP[$arrayidx123] = $conv119;
      var $conv129 = ($val99 & 65535 & 65535) >> 16 - HEAP[$s_addr + 5820 | 0] & 65535;
      HEAP[$s_addr + 5816 | 0] = $conv129;
      var $bi_valid132 = $s_addr + 5820 | 0;
      var $add133 = $len93 - 16 + HEAP[$bi_valid132] | 0;
      HEAP[$bi_valid132] = $add133;
    } else {
      var $bi_buf137 = $s_addr + 5816 | 0;
      var $conv140 = (HEAP[$bi_buf137] & 65535 | 2 << HEAP[$s_addr + 5820 | 0]) & 65535;
      HEAP[$bi_buf137] = $conv140;
      var $bi_valid141 = $s_addr + 5820 | 0;
      var $add142 = HEAP[$bi_valid141] + $len93 | 0;
      HEAP[$bi_valid141] = $add142;
    }
    $len144 = 7;
    if ((HEAP[$s_addr + 5820 | 0] | 0) > (16 - $len144 | 0)) {
      $val151 = 0;
      var $bi_buf157 = $s_addr + 5816 | 0;
      var $conv160 = (HEAP[$bi_buf157] & 65535 | ($val151 & 65535 & 65535) << HEAP[$s_addr + 5820 | 0]) & 65535;
      HEAP[$bi_buf157] = $conv160;
      var $conv164 = HEAP[$s_addr + 5816 | 0] & 65535 & 255 & 255;
      var $pending165 = $s_addr + 20 | 0;
      var $118 = HEAP[$pending165];
      var $inc166 = $118 + 1 | 0;
      HEAP[$pending165] = $inc166;
      var $arrayidx168 = HEAP[$s_addr + 8 | 0] + $118 | 0;
      HEAP[$arrayidx168] = $conv164;
      var $conv172 = (HEAP[$s_addr + 5816 | 0] & 65535) >> 8 & 255;
      var $pending173 = $s_addr + 20 | 0;
      var $124 = HEAP[$pending173];
      var $inc174 = $124 + 1 | 0;
      HEAP[$pending173] = $inc174;
      var $arrayidx176 = HEAP[$s_addr + 8 | 0] + $124 | 0;
      HEAP[$arrayidx176] = $conv172;
      var $conv182 = ($val151 & 65535 & 65535) >> 16 - HEAP[$s_addr + 5820 | 0] & 65535;
      HEAP[$s_addr + 5816 | 0] = $conv182;
      var $bi_valid185 = $s_addr + 5820 | 0;
      var $add186 = $len144 - 16 + HEAP[$bi_valid185] | 0;
      HEAP[$bi_valid185] = $add186;
    } else {
      var $bi_buf191 = $s_addr + 5816 | 0;
      var $conv194 = (HEAP[$bi_buf191] & 65535 | 0 << HEAP[$s_addr + 5820 | 0]) & 65535;
      HEAP[$bi_buf191] = $conv194;
      var $bi_valid195 = $s_addr + 5820 | 0;
      var $add196 = HEAP[$bi_valid195] + $len144 | 0;
      HEAP[$bi_valid195] = $add196;
    }
    _bi_flush($s_addr);
  }
  HEAP[$s_addr + 5812 | 0] = 7;
  return;
  return;
}

__tr_align["X"] = 1;

function __tr_flush_block($s, $buf, $stored_len, $last) {
  var __label__;
  var $s_addr;
  var $buf_addr;
  var $stored_len_addr;
  var $last_addr;
  var $opt_lenb;
  var $static_lenb;
  var $max_blindex;
  var $len;
  var $val;
  var $len65;
  var $val71;
  $s_addr = $s;
  $buf_addr = $buf;
  $stored_len_addr = $stored_len;
  $last_addr = $last;
  $max_blindex = 0;
  var $cmp = (HEAP[$s_addr + 132 | 0] | 0) > 0;
  do {
    if ($cmp) {
      if ((HEAP[HEAP[$s_addr | 0] + 44 | 0] | 0) == 2) {
        var $call = _detect_data_type($s_addr);
        var $data_type4 = HEAP[$s_addr | 0] + 44 | 0;
        HEAP[$data_type4] = $call;
      }
      _build_tree($s_addr, $s_addr + 2840 | 0);
      _build_tree($s_addr, $s_addr + 2852 | 0);
      var $call5 = _build_bl_tree($s_addr);
      $max_blindex = $call5;
      $opt_lenb = (HEAP[$s_addr + 5800 | 0] + 10 | 0) >>> 3;
      $static_lenb = (HEAP[$s_addr + 5804 | 0] + 10 | 0) >>> 3;
      if (!($static_lenb >>> 0 <= $opt_lenb >>> 0)) {
        break;
      }
      $opt_lenb = $static_lenb;
    } else {
      var $add13 = $stored_len_addr + 5 | 0;
      $static_lenb = $add13;
      $opt_lenb = $add13;
    }
  } while (0);
  var $cmp16 = ($stored_len_addr + 4 | 0) >>> 0 <= $opt_lenb >>> 0;
  do {
    if ($cmp16) {
      if (($buf_addr | 0) == 0) {
        __label__ = 9;
        break;
      }
      __tr_stored_block($s_addr, $buf_addr, $stored_len_addr, $last_addr);
      __label__ = 19;
      break;
    }
    __label__ = 9;
  } while (0);
  $if_end128$$if_else19$39 : do {
    if (__label__ == 9) {
      var $cmp20 = (HEAP[$s_addr + 136 | 0] | 0) == 4;
      do {
        if (!$cmp20) {
          if (($static_lenb | 0) == ($opt_lenb | 0)) {
            break;
          }
          $len65 = 3;
          var $add72 = $last_addr + 4 | 0;
          if ((HEAP[$s_addr + 5820 | 0] | 0) > (16 - $len65 | 0)) {
            $val71 = $add72;
            var $bi_buf77 = $s_addr + 5816 | 0;
            var $conv80 = (HEAP[$bi_buf77] & 65535 | ($val71 & 65535 & 65535) << HEAP[$s_addr + 5820 | 0]) & 65535;
            HEAP[$bi_buf77] = $conv80;
            var $conv84 = HEAP[$s_addr + 5816 | 0] & 65535 & 255 & 255;
            var $pending85 = $s_addr + 20 | 0;
            var $80 = HEAP[$pending85];
            var $inc86 = $80 + 1 | 0;
            HEAP[$pending85] = $inc86;
            var $arrayidx88 = HEAP[$s_addr + 8 | 0] + $80 | 0;
            HEAP[$arrayidx88] = $conv84;
            var $conv92 = (HEAP[$s_addr + 5816 | 0] & 65535) >> 8 & 255;
            var $pending93 = $s_addr + 20 | 0;
            var $86 = HEAP[$pending93];
            var $inc94 = $86 + 1 | 0;
            HEAP[$pending93] = $inc94;
            var $arrayidx96 = HEAP[$s_addr + 8 | 0] + $86 | 0;
            HEAP[$arrayidx96] = $conv92;
            var $conv102 = ($val71 & 65535 & 65535) >> 16 - HEAP[$s_addr + 5820 | 0] & 65535;
            HEAP[$s_addr + 5816 | 0] = $conv102;
            var $bi_valid105 = $s_addr + 5820 | 0;
            var $add106 = $len65 - 16 + HEAP[$bi_valid105] | 0;
            HEAP[$bi_valid105] = $add106;
          } else {
            var $bi_buf113 = $s_addr + 5816 | 0;
            var $conv116 = (HEAP[$bi_buf113] & 65535 | ($add72 & 65535 & 65535) << HEAP[$s_addr + 5820 | 0]) & 65535;
            HEAP[$bi_buf113] = $conv116;
            var $bi_valid117 = $s_addr + 5820 | 0;
            var $add118 = HEAP[$bi_valid117] + $len65 | 0;
            HEAP[$bi_valid117] = $add118;
          }
          var $add121 = HEAP[$s_addr + 2844 | 0] + 1 | 0;
          var $add124 = HEAP[$s_addr + 2856 | 0] + 1 | 0;
          _send_all_trees($s_addr, $add121, $add124, $max_blindex + 1 | 0);
          _compress_block($s_addr, $s_addr + 148 | 0, $s_addr + 2440 | 0);
          break $if_end128$$if_else19$39;
        }
      } while (0);
      $len = 3;
      var $add25 = $last_addr + 2 | 0;
      if ((HEAP[$s_addr + 5820 | 0] | 0) > (16 - $len | 0)) {
        $val = $add25;
        var $bi_buf = $s_addr + 5816 | 0;
        var $conv29 = (HEAP[$bi_buf] & 65535 | ($val & 65535 & 65535) << HEAP[$s_addr + 5820 | 0]) & 65535;
        HEAP[$bi_buf] = $conv29;
        var $conv32 = HEAP[$s_addr + 5816 | 0] & 65535 & 255 & 255;
        var $pending = $s_addr + 20 | 0;
        var $44 = HEAP[$pending];
        var $inc = $44 + 1 | 0;
        HEAP[$pending] = $inc;
        var $arrayidx = HEAP[$s_addr + 8 | 0] + $44 | 0;
        HEAP[$arrayidx] = $conv32;
        var $conv36 = (HEAP[$s_addr + 5816 | 0] & 65535) >> 8 & 255;
        var $pending37 = $s_addr + 20 | 0;
        var $50 = HEAP[$pending37];
        var $inc38 = $50 + 1 | 0;
        HEAP[$pending37] = $inc38;
        var $arrayidx40 = HEAP[$s_addr + 8 | 0] + $50 | 0;
        HEAP[$arrayidx40] = $conv36;
        var $conv46 = ($val & 65535 & 65535) >> 16 - HEAP[$s_addr + 5820 | 0] & 65535;
        HEAP[$s_addr + 5816 | 0] = $conv46;
        var $bi_valid49 = $s_addr + 5820 | 0;
        var $add50 = $len - 16 + HEAP[$bi_valid49] | 0;
        HEAP[$bi_valid49] = $add50;
      } else {
        var $bi_buf57 = $s_addr + 5816 | 0;
        var $conv60 = (HEAP[$bi_buf57] & 65535 | ($add25 & 65535 & 65535) << HEAP[$s_addr + 5820 | 0]) & 65535;
        HEAP[$bi_buf57] = $conv60;
        var $bi_valid61 = $s_addr + 5820 | 0;
        var $add62 = HEAP[$bi_valid61] + $len | 0;
        HEAP[$bi_valid61] = $add62;
      }
      _compress_block($s_addr, _static_ltree | 0, _static_dtree | 0);
    }
  } while (0);
  _init_block($s_addr);
  if (($last_addr | 0) != 0) {
    _bi_windup($s_addr);
  }
  return;
  return;
}

__tr_flush_block["X"] = 1;

function _detect_data_type($s) {
  var __label__;
  var $retval;
  var $s_addr;
  var $black_mask;
  var $n;
  $s_addr = $s;
  $black_mask = -201342849;
  $n = 0;
  var $0 = 0;
  $for_cond$2 : while (1) {
    var $0;
    if (!(($0 | 0) <= 31)) {
      __label__ = 6;
      break;
    }
    var $tobool = ($black_mask & 1 | 0) != 0;
    do {
      if ($tobool) {
        if ((HEAP[($n << 2) + $s_addr + 148 | 0] & 65535 | 0) == 0) {
          break;
        }
        $retval = 0;
        __label__ = 16;
        break $for_cond$2;
      }
    } while (0);
    var $inc = $n + 1 | 0;
    $n = $inc;
    var $shr = $black_mask >>> 1;
    $black_mask = $shr;
    var $0 = $inc;
  }
  $for_end$$return$9 : do {
    if (__label__ == 6) {
      var $cmp8 = (HEAP[$s_addr + 184 | 0] & 65535 | 0) != 0;
      do {
        if (!$cmp8) {
          if ((HEAP[$s_addr + 188 | 0] & 65535 | 0) != 0) {
            break;
          }
          if ((HEAP[$s_addr + 200 | 0] & 65535 | 0) != 0) {
            break;
          }
          $n = 32;
          var $13 = 32;
          while (1) {
            var $13;
            if (($13 | 0) >= 256) {
              $retval = 0;
              break $for_end$$return$9;
            }
            if ((HEAP[($n << 2) + $s_addr + 148 | 0] & 65535 | 0) != 0) {
              $retval = 1;
              break $for_end$$return$9;
            }
            var $inc41 = $n + 1 | 0;
            $n = $inc41;
            var $13 = $inc41;
          }
        }
      } while (0);
      $retval = 1;
    }
  } while (0);
  return $retval;
  return null;
}

_detect_data_type["X"] = 1;

function _build_tree($s, $desc) {
  var $s_addr;
  var $desc_addr;
  var $tree;
  var $stree;
  var $elems;
  var $n;
  var $m;
  var $max_code;
  var $node;
  $s_addr = $s;
  $desc_addr = $desc;
  $tree = HEAP[$desc_addr | 0];
  $stree = HEAP[HEAP[$desc_addr + 8 | 0] | 0];
  $elems = HEAP[HEAP[$desc_addr + 8 | 0] + 12 | 0];
  $max_code = -1;
  HEAP[$s_addr + 5200 | 0] = 0;
  HEAP[$s_addr + 5204 | 0] = 573;
  $n = 0;
  var $cmp4 = ($n | 0) < ($elems | 0);
  $for_body$$while_cond_preheader$26 : do {
    if ($cmp4) {
      while (1) {
        var $18 = $n;
        if ((HEAP[($n << 2) + $tree | 0] & 65535 | 0) != 0) {
          $max_code = $18;
          var $heap_len5 = $s_addr + 5200 | 0;
          var $inc = HEAP[$heap_len5] + 1 | 0;
          HEAP[$heap_len5] = $inc;
          var $arrayidx6 = ($inc << 2) + $s_addr + 2908 | 0;
          HEAP[$arrayidx6] = $18;
          HEAP[$n + ($s_addr + 5208) | 0] = 0;
        } else {
          HEAP[($18 << 2) + $tree + 2 | 0] = 0;
        }
        var $inc9 = $n + 1 | 0;
        $n = $inc9;
        if (($n | 0) >= ($elems | 0)) {
          break $for_body$$while_cond_preheader$26;
        }
      }
    }
  } while (0);
  var $cmp113 = (HEAP[$s_addr + 5200 | 0] | 0) < 2;
  var $14 = $max_code;
  $while_body$$while_end$34 : do {
    if ($cmp113) {
      var $28 = $14;
      while (1) {
        var $28;
        if (($28 | 0) < 2) {
          var $inc15 = $max_code + 1 | 0;
          $max_code = $inc15;
          var $cond = $inc15;
        } else {
          var $cond = 0;
        }
        var $cond;
        var $heap_len16 = $s_addr + 5200 | 0;
        var $inc17 = HEAP[$heap_len16] + 1 | 0;
        HEAP[$heap_len16] = $inc17;
        var $arrayidx19 = ($inc17 << 2) + $s_addr + 2908 | 0;
        HEAP[$arrayidx19] = $cond;
        $node = $cond;
        HEAP[($node << 2) + $tree | 0] = 1;
        HEAP[$node + ($s_addr + 5208) | 0] = 0;
        var $opt_len = $s_addr + 5800 | 0;
        var $dec = HEAP[$opt_len] - 1 | 0;
        HEAP[$opt_len] = $dec;
        if (($stree | 0) != 0) {
          var $static_len = $s_addr + 5804 | 0;
          var $sub = HEAP[$static_len] - (HEAP[($node << 2) + $stree + 2 | 0] & 65535) | 0;
          HEAP[$static_len] = $sub;
        }
        var $47 = $max_code;
        if ((HEAP[$s_addr + 5200 | 0] | 0) >= 2) {
          var $_lcssa = $47;
          break $while_body$$while_end$34;
        }
        var $28 = $47;
      }
    } else {
      var $_lcssa = $14;
    }
  } while (0);
  var $_lcssa;
  HEAP[$desc_addr + 4 | 0] = $_lcssa;
  var $div = HEAP[$s_addr + 5200] / 2 | 0;
  $n = $div;
  var $cmp341 = ($div | 0) >= 1;
  $for_body36$$for_end39$44 : do {
    if ($cmp341) {
      while (1) {
        _pqdownheap($s_addr, $tree, $n);
        var $dec38 = $n - 1 | 0;
        $n = $dec38;
        if (!(($dec38 | 0) >= 1)) {
          break $for_body36$$for_end39$44;
        }
      }
    }
  } while (0);
  $node = $elems;
  while (1) {
    $n = HEAP[$s_addr + 2912 | 0];
    var $heap_len42 = $s_addr + 5200 | 0;
    var $59 = HEAP[$heap_len42];
    var $dec43 = $59 - 1 | 0;
    HEAP[$heap_len42] = $dec43;
    var $61 = HEAP[($59 << 2) + $s_addr + 2908 | 0];
    HEAP[$s_addr + 2912 | 0] = $61;
    _pqdownheap($s_addr, $tree, 1);
    $m = HEAP[$s_addr + 2912 | 0];
    var $heap_max50 = $s_addr + 5204 | 0;
    var $dec51 = HEAP[$heap_max50] - 1 | 0;
    HEAP[$heap_max50] = $dec51;
    var $arrayidx53 = ($dec51 << 2) + $s_addr + 2908 | 0;
    HEAP[$arrayidx53] = $n;
    var $heap_max54 = $s_addr + 5204 | 0;
    var $dec55 = HEAP[$heap_max54] - 1 | 0;
    HEAP[$heap_max54] = $dec55;
    var $arrayidx57 = ($dec55 << 2) + $s_addr + 2908 | 0;
    HEAP[$arrayidx57] = $m;
    var $conv66 = (HEAP[($m << 2) + $tree | 0] & 65535) + (HEAP[($n << 2) + $tree | 0] & 65535) & 65535;
    HEAP[($node << 2) + $tree | 0] = $conv66;
    if ((HEAP[$n + ($s_addr + 5208) | 0] & 255 | 0) >= (HEAP[$m + ($s_addr + 5208) | 0] & 255 | 0)) {
      var $cond87 = HEAP[$n + ($s_addr + 5208) | 0] & 255;
    } else {
      var $cond87 = HEAP[$m + ($s_addr + 5208) | 0] & 255;
    }
    var $cond87;
    HEAP[$node + ($s_addr + 5208) | 0] = $cond87 + 1 & 255;
    var $conv92 = $node & 65535;
    HEAP[($m << 2) + $tree + 2 | 0] = $conv92;
    HEAP[($n << 2) + $tree + 2 | 0] = $conv92;
    var $102 = $node;
    var $inc98 = $102 + 1 | 0;
    $node = $inc98;
    HEAP[$s_addr + 2912 | 0] = $102;
    _pqdownheap($s_addr, $tree, 1);
    if (!((HEAP[$s_addr + 5200 | 0] | 0) >= 2)) {
      break;
    }
  }
  var $109 = HEAP[$s_addr + 2912 | 0];
  var $heap_max106 = $s_addr + 5204 | 0;
  var $dec107 = HEAP[$heap_max106] - 1 | 0;
  HEAP[$heap_max106] = $dec107;
  var $arrayidx109 = ($dec107 << 2) + $s_addr + 2908 | 0;
  HEAP[$arrayidx109] = $109;
  _gen_bitlen($s_addr, $desc_addr);
  _gen_codes($tree, $max_code, $s_addr + 2876 | 0);
  return;
  return;
}

_build_tree["X"] = 1;

function _build_bl_tree($s) {
  var $s_addr;
  var $max_blindex;
  $s_addr = $s;
  var $3 = HEAP[$s_addr + 2844 | 0];
  _scan_tree($s_addr, $s_addr + 148 | 0, $3);
  var $7 = HEAP[$s_addr + 2856 | 0];
  _scan_tree($s_addr, $s_addr + 2440 | 0, $7);
  _build_tree($s_addr, $s_addr + 2864 | 0);
  $max_blindex = 18;
  var $10 = 18;
  while (1) {
    var $10;
    if (!(($10 | 0) >= 3)) {
      break;
    }
    var $arrayidx = STRING_TABLE._bl_order + $max_blindex | 0;
    if ((HEAP[((HEAP[$arrayidx] & 255) << 2) + $s_addr + 2686 | 0] & 65535 | 0) != 0) {
      break;
    }
    var $dec = $max_blindex - 1 | 0;
    $max_blindex = $dec;
    var $10 = $dec;
  }
  var $opt_len = $s_addr + 5800 | 0;
  var $add9 = HEAP[$opt_len] + ($max_blindex + 1) * 3 + 14 | 0;
  HEAP[$opt_len] = $add9;
  return $max_blindex;
  return null;
}

_build_bl_tree["X"] = 1;

function _compress_block($s, $ltree, $dtree) {
  var $s_addr;
  var $ltree_addr;
  var $dtree_addr;
  var $dist;
  var $lc;
  var $lx;
  var $code;
  var $extra;
  var $len;
  var $val;
  var $len56;
  var $val68;
  var $len131;
  var $val137;
  var $len193;
  var $val203;
  var $len262;
  var $val268;
  var $len321;
  var $val331;
  $s_addr = $s;
  $ltree_addr = $ltree;
  $dtree_addr = $dtree;
  $lx = 0;
  var $cmp = (HEAP[$s_addr + 5792 | 0] | 0) != 0;
  $do_body$$if_end320$2 : do {
    if ($cmp) {
      while (1) {
        $dist = HEAP[($lx << 1) + HEAP[$s_addr + 5796 | 0] | 0] & 65535;
        var $6 = $lx;
        var $inc = $6 + 1 | 0;
        $lx = $inc;
        $lc = HEAP[HEAP[$s_addr + 5784 | 0] + $6 | 0] & 255;
        var $cmp3 = ($dist | 0) == 0;
        var $11 = $lc;
        do {
          if ($cmp3) {
            $len = HEAP[($11 << 2) + $ltree_addr + 2 | 0] & 65535;
            var $conv14 = HEAP[($lc << 2) + $ltree_addr | 0] & 65535;
            if ((HEAP[$s_addr + 5820 | 0] | 0) > (16 - $len | 0)) {
              $val = $conv14;
              var $bi_buf = $s_addr + 5816 | 0;
              var $conv19 = (HEAP[$bi_buf] & 65535 | ($val & 65535 & 65535) << HEAP[$s_addr + 5820 | 0]) & 65535;
              HEAP[$bi_buf] = $conv19;
              var $conv22 = HEAP[$s_addr + 5816 | 0] & 65535 & 255 & 255;
              var $pending = $s_addr + 20 | 0;
              var $28 = HEAP[$pending];
              var $inc23 = $28 + 1 | 0;
              HEAP[$pending] = $inc23;
              var $arrayidx24 = HEAP[$s_addr + 8 | 0] + $28 | 0;
              HEAP[$arrayidx24] = $conv22;
              var $conv27 = (HEAP[$s_addr + 5816 | 0] & 65535) >> 8 & 255;
              var $pending28 = $s_addr + 20 | 0;
              var $34 = HEAP[$pending28];
              var $inc29 = $34 + 1 | 0;
              HEAP[$pending28] = $inc29;
              var $arrayidx31 = HEAP[$s_addr + 8 | 0] + $34 | 0;
              HEAP[$arrayidx31] = $conv27;
              var $conv37 = ($val & 65535 & 65535) >> 16 - HEAP[$s_addr + 5820 | 0] & 65535;
              HEAP[$s_addr + 5816 | 0] = $conv37;
              var $bi_valid40 = $s_addr + 5820 | 0;
              var $add = $len - 16 + HEAP[$bi_valid40] | 0;
              HEAP[$bi_valid40] = $add;
            } else {
              var $bi_buf47 = $s_addr + 5816 | 0;
              var $conv50 = (HEAP[$bi_buf47] & 65535 | $conv14 << HEAP[$s_addr + 5820 | 0]) & 65535;
              HEAP[$bi_buf47] = $conv50;
              var $bi_valid51 = $s_addr + 5820 | 0;
              var $add52 = HEAP[$bi_valid51] + $len | 0;
              HEAP[$bi_valid51] = $add52;
            }
          } else {
            var $arrayidx54 = STRING_TABLE.__length_code + $11 | 0;
            $code = HEAP[$arrayidx54] & 255;
            $len56 = HEAP[($code + 257 << 2) + $ltree_addr + 2 | 0] & 65535;
            var $conv74 = HEAP[($code + 257 << 2) + $ltree_addr | 0] & 65535;
            if ((HEAP[$s_addr + 5820 | 0] | 0) > (16 - $len56 | 0)) {
              $val68 = $conv74;
              var $bi_buf79 = $s_addr + 5816 | 0;
              var $conv82 = (HEAP[$bi_buf79] & 65535 | ($val68 & 65535 & 65535) << HEAP[$s_addr + 5820 | 0]) & 65535;
              HEAP[$bi_buf79] = $conv82;
              var $conv86 = HEAP[$s_addr + 5816 | 0] & 65535 & 255 & 255;
              var $pending87 = $s_addr + 20 | 0;
              var $69 = HEAP[$pending87];
              var $inc88 = $69 + 1 | 0;
              HEAP[$pending87] = $inc88;
              var $arrayidx90 = HEAP[$s_addr + 8 | 0] + $69 | 0;
              HEAP[$arrayidx90] = $conv86;
              var $conv94 = (HEAP[$s_addr + 5816 | 0] & 65535) >> 8 & 255;
              var $pending95 = $s_addr + 20 | 0;
              var $75 = HEAP[$pending95];
              var $inc96 = $75 + 1 | 0;
              HEAP[$pending95] = $inc96;
              var $arrayidx98 = HEAP[$s_addr + 8 | 0] + $75 | 0;
              HEAP[$arrayidx98] = $conv94;
              var $conv104 = ($val68 & 65535 & 65535) >> 16 - HEAP[$s_addr + 5820 | 0] & 65535;
              HEAP[$s_addr + 5816 | 0] = $conv104;
              var $bi_valid107 = $s_addr + 5820 | 0;
              var $add108 = $len56 - 16 + HEAP[$bi_valid107] | 0;
              HEAP[$bi_valid107] = $add108;
            } else {
              var $bi_buf118 = $s_addr + 5816 | 0;
              var $conv121 = (HEAP[$bi_buf118] & 65535 | $conv74 << HEAP[$s_addr + 5820 | 0]) & 65535;
              HEAP[$bi_buf118] = $conv121;
              var $bi_valid122 = $s_addr + 5820 | 0;
              var $add123 = HEAP[$bi_valid122] + $len56 | 0;
              HEAP[$bi_valid122] = $add123;
            }
            var $93 = HEAP[($code << 2) + _extra_lbits | 0];
            $extra = $93;
            if (($93 | 0) != 0) {
              var $sub130 = $lc - HEAP[($code << 2) + _base_length | 0] | 0;
              $lc = $sub130;
              $len131 = $extra;
              var $101 = $lc;
              if ((HEAP[$s_addr + 5820 | 0] | 0) > (16 - $len131 | 0)) {
                $val137 = $101;
                var $bi_buf142 = $s_addr + 5816 | 0;
                var $conv145 = (HEAP[$bi_buf142] & 65535 | ($val137 & 65535 & 65535) << HEAP[$s_addr + 5820 | 0]) & 65535;
                HEAP[$bi_buf142] = $conv145;
                var $conv149 = HEAP[$s_addr + 5816 | 0] & 65535 & 255 & 255;
                var $pending150 = $s_addr + 20 | 0;
                var $110 = HEAP[$pending150];
                var $inc151 = $110 + 1 | 0;
                HEAP[$pending150] = $inc151;
                var $arrayidx153 = HEAP[$s_addr + 8 | 0] + $110 | 0;
                HEAP[$arrayidx153] = $conv149;
                var $conv157 = (HEAP[$s_addr + 5816 | 0] & 65535) >> 8 & 255;
                var $pending158 = $s_addr + 20 | 0;
                var $116 = HEAP[$pending158];
                var $inc159 = $116 + 1 | 0;
                HEAP[$pending158] = $inc159;
                var $arrayidx161 = HEAP[$s_addr + 8 | 0] + $116 | 0;
                HEAP[$arrayidx161] = $conv157;
                var $conv167 = ($val137 & 65535 & 65535) >> 16 - HEAP[$s_addr + 5820 | 0] & 65535;
                HEAP[$s_addr + 5816 | 0] = $conv167;
                var $bi_valid170 = $s_addr + 5820 | 0;
                var $add171 = $len131 - 16 + HEAP[$bi_valid170] | 0;
                HEAP[$bi_valid170] = $add171;
              } else {
                var $bi_buf177 = $s_addr + 5816 | 0;
                var $conv180 = (HEAP[$bi_buf177] & 65535 | ($101 & 65535 & 65535) << HEAP[$s_addr + 5820 | 0]) & 65535;
                HEAP[$bi_buf177] = $conv180;
                var $bi_valid181 = $s_addr + 5820 | 0;
                var $add182 = HEAP[$bi_valid181] + $len131 | 0;
                HEAP[$bi_valid181] = $add182;
              }
            }
            var $dec = $dist - 1 | 0;
            $dist = $dec;
            var $134 = $dist;
            if ($dec >>> 0 < 256) {
              var $arrayidx187 = STRING_TABLE.__dist_code + $134 | 0;
              var $cond = HEAP[$arrayidx187] & 255;
            } else {
              var $arrayidx191 = STRING_TABLE.__dist_code + ($134 >>> 7) + 256 | 0;
              var $cond = HEAP[$arrayidx191] & 255;
            }
            var $cond;
            $code = $cond;
            $len193 = HEAP[($code << 2) + $dtree_addr + 2 | 0] & 65535;
            var $conv207 = HEAP[($code << 2) + $dtree_addr | 0] & 65535;
            if ((HEAP[$s_addr + 5820 | 0] | 0) > (16 - $len193 | 0)) {
              $val203 = $conv207;
              var $bi_buf212 = $s_addr + 5816 | 0;
              var $conv215 = (HEAP[$bi_buf212] & 65535 | ($val203 & 65535 & 65535) << HEAP[$s_addr + 5820 | 0]) & 65535;
              HEAP[$bi_buf212] = $conv215;
              var $conv219 = HEAP[$s_addr + 5816 | 0] & 65535 & 255 & 255;
              var $pending220 = $s_addr + 20 | 0;
              var $154 = HEAP[$pending220];
              var $inc221 = $154 + 1 | 0;
              HEAP[$pending220] = $inc221;
              var $arrayidx223 = HEAP[$s_addr + 8 | 0] + $154 | 0;
              HEAP[$arrayidx223] = $conv219;
              var $conv227 = (HEAP[$s_addr + 5816 | 0] & 65535) >> 8 & 255;
              var $pending228 = $s_addr + 20 | 0;
              var $160 = HEAP[$pending228];
              var $inc229 = $160 + 1 | 0;
              HEAP[$pending228] = $inc229;
              var $arrayidx231 = HEAP[$s_addr + 8 | 0] + $160 | 0;
              HEAP[$arrayidx231] = $conv227;
              var $conv237 = ($val203 & 65535 & 65535) >> 16 - HEAP[$s_addr + 5820 | 0] & 65535;
              HEAP[$s_addr + 5816 | 0] = $conv237;
              var $bi_valid240 = $s_addr + 5820 | 0;
              var $add241 = $len193 - 16 + HEAP[$bi_valid240] | 0;
              HEAP[$bi_valid240] = $add241;
            } else {
              var $bi_buf249 = $s_addr + 5816 | 0;
              var $conv252 = (HEAP[$bi_buf249] & 65535 | $conv207 << HEAP[$s_addr + 5820 | 0]) & 65535;
              HEAP[$bi_buf249] = $conv252;
              var $bi_valid253 = $s_addr + 5820 | 0;
              var $add254 = HEAP[$bi_valid253] + $len193 | 0;
              HEAP[$bi_valid253] = $add254;
            }
            var $178 = HEAP[($code << 2) + _extra_dbits | 0];
            $extra = $178;
            if (($178 | 0) == 0) {
              break;
            }
            var $sub261 = $dist - HEAP[($code << 2) + _base_dist | 0] | 0;
            $dist = $sub261;
            $len262 = $extra;
            var $186 = $dist;
            if ((HEAP[$s_addr + 5820 | 0] | 0) > (16 - $len262 | 0)) {
              $val268 = $186;
              var $bi_buf273 = $s_addr + 5816 | 0;
              var $conv276 = (HEAP[$bi_buf273] & 65535 | ($val268 & 65535 & 65535) << HEAP[$s_addr + 5820 | 0]) & 65535;
              HEAP[$bi_buf273] = $conv276;
              var $conv280 = HEAP[$s_addr + 5816 | 0] & 65535 & 255 & 255;
              var $pending281 = $s_addr + 20 | 0;
              var $195 = HEAP[$pending281];
              var $inc282 = $195 + 1 | 0;
              HEAP[$pending281] = $inc282;
              var $arrayidx284 = HEAP[$s_addr + 8 | 0] + $195 | 0;
              HEAP[$arrayidx284] = $conv280;
              var $conv288 = (HEAP[$s_addr + 5816 | 0] & 65535) >> 8 & 255;
              var $pending289 = $s_addr + 20 | 0;
              var $201 = HEAP[$pending289];
              var $inc290 = $201 + 1 | 0;
              HEAP[$pending289] = $inc290;
              var $arrayidx292 = HEAP[$s_addr + 8 | 0] + $201 | 0;
              HEAP[$arrayidx292] = $conv288;
              var $conv298 = ($val268 & 65535 & 65535) >> 16 - HEAP[$s_addr + 5820 | 0] & 65535;
              HEAP[$s_addr + 5816 | 0] = $conv298;
              var $bi_valid301 = $s_addr + 5820 | 0;
              var $add302 = $len262 - 16 + HEAP[$bi_valid301] | 0;
              HEAP[$bi_valid301] = $add302;
            } else {
              var $bi_buf308 = $s_addr + 5816 | 0;
              var $conv311 = (HEAP[$bi_buf308] & 65535 | ($186 & 65535 & 65535) << HEAP[$s_addr + 5820 | 0]) & 65535;
              HEAP[$bi_buf308] = $conv311;
              var $bi_valid312 = $s_addr + 5820 | 0;
              var $add313 = HEAP[$bi_valid312] + $len262 | 0;
              HEAP[$bi_valid312] = $add313;
            }
          }
        } while (0);
        if ($lx >>> 0 >= HEAP[$s_addr + 5792 | 0] >>> 0) {
          break $do_body$$if_end320$2;
        }
      }
    }
  } while (0);
  $len321 = HEAP[$ltree_addr + 1026 | 0] & 65535;
  var $conv335 = HEAP[$ltree_addr + 1024 | 0] & 65535;
  if ((HEAP[$s_addr + 5820 | 0] | 0) > (16 - $len321 | 0)) {
    $val331 = $conv335;
    var $bi_buf340 = $s_addr + 5816 | 0;
    var $conv343 = (HEAP[$bi_buf340] & 65535 | ($val331 & 65535 & 65535) << HEAP[$s_addr + 5820 | 0]) & 65535;
    HEAP[$bi_buf340] = $conv343;
    var $conv347 = HEAP[$s_addr + 5816 | 0] & 65535 & 255 & 255;
    var $pending348 = $s_addr + 20 | 0;
    var $236 = HEAP[$pending348];
    var $inc349 = $236 + 1 | 0;
    HEAP[$pending348] = $inc349;
    var $arrayidx351 = HEAP[$s_addr + 8 | 0] + $236 | 0;
    HEAP[$arrayidx351] = $conv347;
    var $conv355 = (HEAP[$s_addr + 5816 | 0] & 65535) >> 8 & 255;
    var $pending356 = $s_addr + 20 | 0;
    var $242 = HEAP[$pending356];
    var $inc357 = $242 + 1 | 0;
    HEAP[$pending356] = $inc357;
    var $arrayidx359 = HEAP[$s_addr + 8 | 0] + $242 | 0;
    HEAP[$arrayidx359] = $conv355;
    var $conv365 = ($val331 & 65535 & 65535) >> 16 - HEAP[$s_addr + 5820 | 0] & 65535;
    HEAP[$s_addr + 5816 | 0] = $conv365;
    var $bi_valid368 = $s_addr + 5820 | 0;
    var $add369 = $len321 - 16 + HEAP[$bi_valid368] | 0;
    HEAP[$bi_valid368] = $add369;
  } else {
    var $bi_buf377 = $s_addr + 5816 | 0;
    var $conv380 = (HEAP[$bi_buf377] & 65535 | $conv335 << HEAP[$s_addr + 5820 | 0]) & 65535;
    HEAP[$bi_buf377] = $conv380;
    var $bi_valid381 = $s_addr + 5820 | 0;
    var $add382 = HEAP[$bi_valid381] + $len321 | 0;
    HEAP[$bi_valid381] = $add382;
  }
  var $conv387 = HEAP[$ltree_addr + 1026 | 0] & 65535;
  HEAP[$s_addr + 5812 | 0] = $conv387;
  return;
  return;
}

_compress_block["X"] = 1;

function _bi_windup($s) {
  var $s_addr;
  $s_addr = $s;
  var $cmp = (HEAP[$s_addr + 5820 | 0] | 0) > 8;
  var $2 = $s_addr;
  do {
    if ($cmp) {
      var $conv1 = HEAP[$2 + 5816 | 0] & 65535 & 255 & 255;
      var $pending = $s_addr + 20 | 0;
      var $5 = HEAP[$pending];
      var $inc = $5 + 1 | 0;
      HEAP[$pending] = $inc;
      var $arrayidx = HEAP[$s_addr + 8 | 0] + $5 | 0;
      HEAP[$arrayidx] = $conv1;
      var $conv4 = (HEAP[$s_addr + 5816 | 0] & 65535) >> 8 & 255;
      var $pending5 = $s_addr + 20 | 0;
      var $11 = HEAP[$pending5];
      var $inc6 = $11 + 1 | 0;
      HEAP[$pending5] = $inc6;
      var $arrayidx8 = HEAP[$s_addr + 8 | 0] + $11 | 0;
      HEAP[$arrayidx8] = $conv4;
    } else {
      if ((HEAP[$2 + 5820 | 0] | 0) <= 0) {
        break;
      }
      var $conv14 = HEAP[$s_addr + 5816 | 0] & 255;
      var $pending15 = $s_addr + 20 | 0;
      var $18 = HEAP[$pending15];
      var $inc16 = $18 + 1 | 0;
      HEAP[$pending15] = $inc16;
      var $arrayidx18 = HEAP[$s_addr + 8 | 0] + $18 | 0;
      HEAP[$arrayidx18] = $conv14;
    }
  } while (0);
  HEAP[$s_addr + 5816 | 0] = 0;
  HEAP[$s_addr + 5820 | 0] = 0;
  return;
  return;
}

_bi_windup["X"] = 1;

function _send_all_trees($s, $lcodes, $dcodes, $blcodes) {
  var $s_addr;
  var $lcodes_addr;
  var $dcodes_addr;
  var $blcodes_addr;
  var $rank;
  var $len;
  var $val;
  var $len36;
  var $val42;
  var $len91;
  var $val97;
  var $len148;
  var $val154;
  $s_addr = $s;
  $lcodes_addr = $lcodes;
  $dcodes_addr = $dcodes;
  $blcodes_addr = $blcodes;
  $len = 5;
  var $sub1 = $lcodes_addr - 257 | 0;
  if ((HEAP[$s_addr + 5820 | 0] | 0) > (16 - $len | 0)) {
    $val = $sub1;
    var $bi_buf = $s_addr + 5816 | 0;
    var $conv5 = (HEAP[$bi_buf] & 65535 | ($val & 65535 & 65535) << HEAP[$s_addr + 5820 | 0]) & 65535;
    HEAP[$bi_buf] = $conv5;
    var $conv8 = HEAP[$s_addr + 5816 | 0] & 65535 & 255 & 255;
    var $pending = $s_addr + 20 | 0;
    var $12 = HEAP[$pending];
    var $inc = $12 + 1 | 0;
    HEAP[$pending] = $inc;
    var $arrayidx = HEAP[$s_addr + 8 | 0] + $12 | 0;
    HEAP[$arrayidx] = $conv8;
    var $conv11 = (HEAP[$s_addr + 5816 | 0] & 65535) >> 8 & 255;
    var $pending12 = $s_addr + 20 | 0;
    var $18 = HEAP[$pending12];
    var $inc13 = $18 + 1 | 0;
    HEAP[$pending12] = $inc13;
    var $arrayidx15 = HEAP[$s_addr + 8 | 0] + $18 | 0;
    HEAP[$arrayidx15] = $conv11;
    var $conv21 = ($val & 65535 & 65535) >> 16 - HEAP[$s_addr + 5820 | 0] & 65535;
    HEAP[$s_addr + 5816 | 0] = $conv21;
    var $bi_valid24 = $s_addr + 5820 | 0;
    var $add = $len - 16 + HEAP[$bi_valid24] | 0;
    HEAP[$bi_valid24] = $add;
  } else {
    var $bi_buf30 = $s_addr + 5816 | 0;
    var $conv33 = (HEAP[$bi_buf30] & 65535 | ($sub1 & 65535 & 65535) << HEAP[$s_addr + 5820 | 0]) & 65535;
    HEAP[$bi_buf30] = $conv33;
    var $bi_valid34 = $s_addr + 5820 | 0;
    var $add35 = HEAP[$bi_valid34] + $len | 0;
    HEAP[$bi_valid34] = $add35;
  }
  $len36 = 5;
  var $sub43 = $dcodes_addr - 1 | 0;
  if ((HEAP[$s_addr + 5820 | 0] | 0) > (16 - $len36 | 0)) {
    $val42 = $sub43;
    var $bi_buf48 = $s_addr + 5816 | 0;
    var $conv51 = (HEAP[$bi_buf48] & 65535 | ($val42 & 65535 & 65535) << HEAP[$s_addr + 5820 | 0]) & 65535;
    HEAP[$bi_buf48] = $conv51;
    var $conv55 = HEAP[$s_addr + 5816 | 0] & 65535 & 255 & 255;
    var $pending56 = $s_addr + 20 | 0;
    var $47 = HEAP[$pending56];
    var $inc57 = $47 + 1 | 0;
    HEAP[$pending56] = $inc57;
    var $arrayidx59 = HEAP[$s_addr + 8 | 0] + $47 | 0;
    HEAP[$arrayidx59] = $conv55;
    var $conv63 = (HEAP[$s_addr + 5816 | 0] & 65535) >> 8 & 255;
    var $pending64 = $s_addr + 20 | 0;
    var $53 = HEAP[$pending64];
    var $inc65 = $53 + 1 | 0;
    HEAP[$pending64] = $inc65;
    var $arrayidx67 = HEAP[$s_addr + 8 | 0] + $53 | 0;
    HEAP[$arrayidx67] = $conv63;
    var $conv73 = ($val42 & 65535 & 65535) >> 16 - HEAP[$s_addr + 5820 | 0] & 65535;
    HEAP[$s_addr + 5816 | 0] = $conv73;
    var $bi_valid76 = $s_addr + 5820 | 0;
    var $add77 = $len36 - 16 + HEAP[$bi_valid76] | 0;
    HEAP[$bi_valid76] = $add77;
  } else {
    var $bi_buf84 = $s_addr + 5816 | 0;
    var $conv87 = (HEAP[$bi_buf84] & 65535 | ($sub43 & 65535 & 65535) << HEAP[$s_addr + 5820 | 0]) & 65535;
    HEAP[$bi_buf84] = $conv87;
    var $bi_valid88 = $s_addr + 5820 | 0;
    var $add89 = HEAP[$bi_valid88] + $len36 | 0;
    HEAP[$bi_valid88] = $add89;
  }
  $len91 = 4;
  var $sub98 = $blcodes_addr - 4 | 0;
  if ((HEAP[$s_addr + 5820 | 0] | 0) > (16 - $len91 | 0)) {
    $val97 = $sub98;
    var $bi_buf103 = $s_addr + 5816 | 0;
    var $conv106 = (HEAP[$bi_buf103] & 65535 | ($val97 & 65535 & 65535) << HEAP[$s_addr + 5820 | 0]) & 65535;
    HEAP[$bi_buf103] = $conv106;
    var $conv110 = HEAP[$s_addr + 5816 | 0] & 65535 & 255 & 255;
    var $pending111 = $s_addr + 20 | 0;
    var $82 = HEAP[$pending111];
    var $inc112 = $82 + 1 | 0;
    HEAP[$pending111] = $inc112;
    var $arrayidx114 = HEAP[$s_addr + 8 | 0] + $82 | 0;
    HEAP[$arrayidx114] = $conv110;
    var $conv118 = (HEAP[$s_addr + 5816 | 0] & 65535) >> 8 & 255;
    var $pending119 = $s_addr + 20 | 0;
    var $88 = HEAP[$pending119];
    var $inc120 = $88 + 1 | 0;
    HEAP[$pending119] = $inc120;
    var $arrayidx122 = HEAP[$s_addr + 8 | 0] + $88 | 0;
    HEAP[$arrayidx122] = $conv118;
    var $conv128 = ($val97 & 65535 & 65535) >> 16 - HEAP[$s_addr + 5820 | 0] & 65535;
    HEAP[$s_addr + 5816 | 0] = $conv128;
    var $bi_valid131 = $s_addr + 5820 | 0;
    var $add132 = $len91 - 16 + HEAP[$bi_valid131] | 0;
    HEAP[$bi_valid131] = $add132;
  } else {
    var $bi_buf139 = $s_addr + 5816 | 0;
    var $conv142 = (HEAP[$bi_buf139] & 65535 | ($sub98 & 65535 & 65535) << HEAP[$s_addr + 5820 | 0]) & 65535;
    HEAP[$bi_buf139] = $conv142;
    var $bi_valid143 = $s_addr + 5820 | 0;
    var $add144 = HEAP[$bi_valid143] + $len91 | 0;
    HEAP[$bi_valid143] = $add144;
  }
  $rank = 0;
  var $cmp1461 = ($rank | 0) < ($blcodes_addr | 0);
  $for_body$$for_end$14 : do {
    if ($cmp1461) {
      while (1) {
        $len148 = 3;
        var $arrayidx155 = STRING_TABLE._bl_order + $rank | 0;
        var $conv158 = HEAP[((HEAP[$arrayidx155] & 255) << 2) + $s_addr + 2686 | 0] & 65535;
        if ((HEAP[$s_addr + 5820 | 0] | 0) > (16 - $len148 | 0)) {
          $val154 = $conv158;
          var $bi_buf163 = $s_addr + 5816 | 0;
          var $conv166 = (HEAP[$bi_buf163] & 65535 | ($val154 & 65535 & 65535) << HEAP[$s_addr + 5820 | 0]) & 65535;
          HEAP[$bi_buf163] = $conv166;
          var $conv170 = HEAP[$s_addr + 5816 | 0] & 65535 & 255 & 255;
          var $pending171 = $s_addr + 20 | 0;
          var $122 = HEAP[$pending171];
          var $inc172 = $122 + 1 | 0;
          HEAP[$pending171] = $inc172;
          var $arrayidx174 = HEAP[$s_addr + 8 | 0] + $122 | 0;
          HEAP[$arrayidx174] = $conv170;
          var $conv178 = (HEAP[$s_addr + 5816 | 0] & 65535) >> 8 & 255;
          var $pending179 = $s_addr + 20 | 0;
          var $128 = HEAP[$pending179];
          var $inc180 = $128 + 1 | 0;
          HEAP[$pending179] = $inc180;
          var $arrayidx182 = HEAP[$s_addr + 8 | 0] + $128 | 0;
          HEAP[$arrayidx182] = $conv178;
          var $conv188 = ($val154 & 65535 & 65535) >> 16 - HEAP[$s_addr + 5820 | 0] & 65535;
          HEAP[$s_addr + 5816 | 0] = $conv188;
          var $bi_valid191 = $s_addr + 5820 | 0;
          var $add192 = $len148 - 16 + HEAP[$bi_valid191] | 0;
          HEAP[$bi_valid191] = $add192;
        } else {
          var $bi_buf203 = $s_addr + 5816 | 0;
          var $conv206 = (HEAP[$bi_buf203] & 65535 | $conv158 << HEAP[$s_addr + 5820 | 0]) & 65535;
          HEAP[$bi_buf203] = $conv206;
          var $bi_valid207 = $s_addr + 5820 | 0;
          var $add208 = HEAP[$bi_valid207] + $len148 | 0;
          HEAP[$bi_valid207] = $add208;
        }
        var $inc210 = $rank + 1 | 0;
        $rank = $inc210;
        if (($rank | 0) >= ($blcodes_addr | 0)) {
          break $for_body$$for_end$14;
        }
      }
    }
  } while (0);
  _send_tree($s_addr, $s_addr + 148 | 0, $lcodes_addr - 1 | 0);
  _send_tree($s_addr, $s_addr + 2440 | 0, $dcodes_addr - 1 | 0);
  return;
  return;
}

_send_all_trees["X"] = 1;

function _send_tree($s, $tree, $max_code) {
  var __label__;
  var $s_addr;
  var $tree_addr;
  var $max_code_addr;
  var $n;
  var $prevlen;
  var $curlen;
  var $nextlen;
  var $count;
  var $max_count;
  var $min_count;
  var $len16;
  var $val;
  var $len78;
  var $val89;
  var $len146;
  var $val157;
  var $len212;
  var $val218;
  var $len271;
  var $val282;
  var $len337;
  var $val343;
  var $len393;
  var $val404;
  var $len459;
  var $val465;
  $s_addr = $s;
  $tree_addr = $tree;
  $max_code_addr = $max_code;
  $prevlen = -1;
  $nextlen = HEAP[$tree_addr + 2 | 0] & 65535;
  $count = 0;
  $max_count = 7;
  $min_count = 4;
  if (($nextlen | 0) == 0) {
    $max_count = 138;
    $min_count = 3;
  }
  $n = 0;
  var $cmp22 = ($n | 0) <= ($max_code_addr | 0);
  $for_body$$for_end$5 : do {
    if ($cmp22) {
      while (1) {
        $curlen = $nextlen;
        $nextlen = HEAP[($n + 1 << 2) + $tree_addr + 2 | 0] & 65535;
        var $inc = $count + 1 | 0;
        $count = $inc;
        var $cmp8 = ($inc | 0) < ($max_count | 0);
        do {
          if ($cmp8) {
            if (($curlen | 0) == ($nextlen | 0)) {
              __label__ = 40;
              break;
            }
            __label__ = 5;
            break;
          } else {
            __label__ = 5;
          }
        } while (0);
        if (__label__ == 5) {
          var $cmp13 = ($count | 0) < ($min_count | 0);
          $do_body$$if_else71$12 : do {
            if ($cmp13) {
              while (1) {
                $len16 = HEAP[($curlen << 2) + $s_addr + 2686 | 0] & 65535;
                var $conv26 = HEAP[($curlen << 2) + $s_addr + 2684 | 0] & 65535;
                if ((HEAP[$s_addr + 5820 | 0] | 0) > (16 - $len16 | 0)) {
                  $val = $conv26;
                  var $bi_buf = $s_addr + 5816 | 0;
                  var $conv31 = (HEAP[$bi_buf] & 65535 | ($val & 65535 & 65535) << HEAP[$s_addr + 5820 | 0]) & 65535;
                  HEAP[$bi_buf] = $conv31;
                  var $conv34 = HEAP[$s_addr + 5816 | 0] & 65535 & 255 & 255;
                  var $pending = $s_addr + 20 | 0;
                  var $32 = HEAP[$pending];
                  var $inc35 = $32 + 1 | 0;
                  HEAP[$pending] = $inc35;
                  var $arrayidx36 = HEAP[$s_addr + 8 | 0] + $32 | 0;
                  HEAP[$arrayidx36] = $conv34;
                  var $conv39 = (HEAP[$s_addr + 5816 | 0] & 65535) >> 8 & 255;
                  var $pending40 = $s_addr + 20 | 0;
                  var $38 = HEAP[$pending40];
                  var $inc41 = $38 + 1 | 0;
                  HEAP[$pending40] = $inc41;
                  var $arrayidx43 = HEAP[$s_addr + 8 | 0] + $38 | 0;
                  HEAP[$arrayidx43] = $conv39;
                  var $conv49 = ($val & 65535 & 65535) >> 16 - HEAP[$s_addr + 5820 | 0] & 65535;
                  HEAP[$s_addr + 5816 | 0] = $conv49;
                  var $bi_valid52 = $s_addr + 5820 | 0;
                  var $add53 = $len16 - 16 + HEAP[$bi_valid52] | 0;
                  HEAP[$bi_valid52] = $add53;
                } else {
                  var $bi_buf62 = $s_addr + 5816 | 0;
                  var $conv65 = (HEAP[$bi_buf62] & 65535 | $conv26 << HEAP[$s_addr + 5820 | 0]) & 65535;
                  HEAP[$bi_buf62] = $conv65;
                  var $bi_valid66 = $s_addr + 5820 | 0;
                  var $add67 = HEAP[$bi_valid66] + $len16 | 0;
                  HEAP[$bi_valid66] = $add67;
                }
                var $dec = $count - 1 | 0;
                $count = $dec;
                if (($dec | 0) == 0) {
                  break $do_body$$if_else71$12;
                }
              }
            } else {
              if (($curlen | 0) != 0) {
                if (($curlen | 0) != ($prevlen | 0)) {
                  $len78 = HEAP[($curlen << 2) + $s_addr + 2686 | 0] & 65535;
                  var $conv94 = HEAP[($curlen << 2) + $s_addr + 2684 | 0] & 65535;
                  if ((HEAP[$s_addr + 5820 | 0] | 0) > (16 - $len78 | 0)) {
                    $val89 = $conv94;
                    var $bi_buf99 = $s_addr + 5816 | 0;
                    var $conv102 = (HEAP[$bi_buf99] & 65535 | ($val89 & 65535 & 65535) << HEAP[$s_addr + 5820 | 0]) & 65535;
                    HEAP[$bi_buf99] = $conv102;
                    var $conv106 = HEAP[$s_addr + 5816 | 0] & 65535 & 255 & 255;
                    var $pending107 = $s_addr + 20 | 0;
                    var $76 = HEAP[$pending107];
                    var $inc108 = $76 + 1 | 0;
                    HEAP[$pending107] = $inc108;
                    var $arrayidx110 = HEAP[$s_addr + 8 | 0] + $76 | 0;
                    HEAP[$arrayidx110] = $conv106;
                    var $conv114 = (HEAP[$s_addr + 5816 | 0] & 65535) >> 8 & 255;
                    var $pending115 = $s_addr + 20 | 0;
                    var $82 = HEAP[$pending115];
                    var $inc116 = $82 + 1 | 0;
                    HEAP[$pending115] = $inc116;
                    var $arrayidx118 = HEAP[$s_addr + 8 | 0] + $82 | 0;
                    HEAP[$arrayidx118] = $conv114;
                    var $conv124 = ($val89 & 65535 & 65535) >> 16 - HEAP[$s_addr + 5820 | 0] & 65535;
                    HEAP[$s_addr + 5816 | 0] = $conv124;
                    var $bi_valid127 = $s_addr + 5820 | 0;
                    var $add128 = $len78 - 16 + HEAP[$bi_valid127] | 0;
                    HEAP[$bi_valid127] = $add128;
                  } else {
                    var $bi_buf137 = $s_addr + 5816 | 0;
                    var $conv140 = (HEAP[$bi_buf137] & 65535 | $conv94 << HEAP[$s_addr + 5820 | 0]) & 65535;
                    HEAP[$bi_buf137] = $conv140;
                    var $bi_valid141 = $s_addr + 5820 | 0;
                    var $add142 = HEAP[$bi_valid141] + $len78 | 0;
                    HEAP[$bi_valid141] = $add142;
                  }
                  var $dec144 = $count - 1 | 0;
                  $count = $dec144;
                }
                $len146 = HEAP[$s_addr + 2750 | 0] & 65535;
                var $conv162 = HEAP[$s_addr + 2748 | 0] & 65535;
                if ((HEAP[$s_addr + 5820 | 0] | 0) > (16 - $len146 | 0)) {
                  $val157 = $conv162;
                  var $bi_buf167 = $s_addr + 5816 | 0;
                  var $conv170 = (HEAP[$bi_buf167] & 65535 | ($val157 & 65535 & 65535) << HEAP[$s_addr + 5820 | 0]) & 65535;
                  HEAP[$bi_buf167] = $conv170;
                  var $conv174 = HEAP[$s_addr + 5816 | 0] & 65535 & 255 & 255;
                  var $pending175 = $s_addr + 20 | 0;
                  var $115 = HEAP[$pending175];
                  var $inc176 = $115 + 1 | 0;
                  HEAP[$pending175] = $inc176;
                  var $arrayidx178 = HEAP[$s_addr + 8 | 0] + $115 | 0;
                  HEAP[$arrayidx178] = $conv174;
                  var $conv182 = (HEAP[$s_addr + 5816 | 0] & 65535) >> 8 & 255;
                  var $pending183 = $s_addr + 20 | 0;
                  var $121 = HEAP[$pending183];
                  var $inc184 = $121 + 1 | 0;
                  HEAP[$pending183] = $inc184;
                  var $arrayidx186 = HEAP[$s_addr + 8 | 0] + $121 | 0;
                  HEAP[$arrayidx186] = $conv182;
                  var $conv192 = ($val157 & 65535 & 65535) >> 16 - HEAP[$s_addr + 5820 | 0] & 65535;
                  HEAP[$s_addr + 5816 | 0] = $conv192;
                  var $bi_valid195 = $s_addr + 5820 | 0;
                  var $add196 = $len146 - 16 + HEAP[$bi_valid195] | 0;
                  HEAP[$bi_valid195] = $add196;
                } else {
                  var $bi_buf205 = $s_addr + 5816 | 0;
                  var $conv208 = (HEAP[$bi_buf205] & 65535 | $conv162 << HEAP[$s_addr + 5820 | 0]) & 65535;
                  HEAP[$bi_buf205] = $conv208;
                  var $bi_valid209 = $s_addr + 5820 | 0;
                  var $add210 = HEAP[$bi_valid209] + $len146 | 0;
                  HEAP[$bi_valid209] = $add210;
                }
                $len212 = 2;
                var $sub219 = $count - 3 | 0;
                if ((HEAP[$s_addr + 5820 | 0] | 0) > (16 - $len212 | 0)) {
                  $val218 = $sub219;
                  var $bi_buf224 = $s_addr + 5816 | 0;
                  var $conv227 = (HEAP[$bi_buf224] & 65535 | ($val218 & 65535 & 65535) << HEAP[$s_addr + 5820 | 0]) & 65535;
                  HEAP[$bi_buf224] = $conv227;
                  var $conv231 = HEAP[$s_addr + 5816 | 0] & 65535 & 255 & 255;
                  var $pending232 = $s_addr + 20 | 0;
                  var $150 = HEAP[$pending232];
                  var $inc233 = $150 + 1 | 0;
                  HEAP[$pending232] = $inc233;
                  var $arrayidx235 = HEAP[$s_addr + 8 | 0] + $150 | 0;
                  HEAP[$arrayidx235] = $conv231;
                  var $conv239 = (HEAP[$s_addr + 5816 | 0] & 65535) >> 8 & 255;
                  var $pending240 = $s_addr + 20 | 0;
                  var $156 = HEAP[$pending240];
                  var $inc241 = $156 + 1 | 0;
                  HEAP[$pending240] = $inc241;
                  var $arrayidx243 = HEAP[$s_addr + 8 | 0] + $156 | 0;
                  HEAP[$arrayidx243] = $conv239;
                  var $conv249 = ($val218 & 65535 & 65535) >> 16 - HEAP[$s_addr + 5820 | 0] & 65535;
                  HEAP[$s_addr + 5816 | 0] = $conv249;
                  var $bi_valid252 = $s_addr + 5820 | 0;
                  var $add253 = $len212 - 16 + HEAP[$bi_valid252] | 0;
                  HEAP[$bi_valid252] = $add253;
                } else {
                  var $bi_buf260 = $s_addr + 5816 | 0;
                  var $conv263 = (HEAP[$bi_buf260] & 65535 | ($sub219 & 65535 & 65535) << HEAP[$s_addr + 5820 | 0]) & 65535;
                  HEAP[$bi_buf260] = $conv263;
                  var $bi_valid264 = $s_addr + 5820 | 0;
                  var $add265 = HEAP[$bi_valid264] + $len212 | 0;
                  HEAP[$bi_valid264] = $add265;
                }
              } else {
                var $bl_tree272 = $s_addr + 2684 | 0;
                if (($count | 0) <= 10) {
                  $len271 = HEAP[$bl_tree272 + 70 | 0] & 65535;
                  var $conv287 = HEAP[$s_addr + 2752 | 0] & 65535;
                  if ((HEAP[$s_addr + 5820 | 0] | 0) > (16 - $len271 | 0)) {
                    $val282 = $conv287;
                    var $bi_buf292 = $s_addr + 5816 | 0;
                    var $conv295 = (HEAP[$bi_buf292] & 65535 | ($val282 & 65535 & 65535) << HEAP[$s_addr + 5820 | 0]) & 65535;
                    HEAP[$bi_buf292] = $conv295;
                    var $conv299 = HEAP[$s_addr + 5816 | 0] & 65535 & 255 & 255;
                    var $pending300 = $s_addr + 20 | 0;
                    var $189 = HEAP[$pending300];
                    var $inc301 = $189 + 1 | 0;
                    HEAP[$pending300] = $inc301;
                    var $arrayidx303 = HEAP[$s_addr + 8 | 0] + $189 | 0;
                    HEAP[$arrayidx303] = $conv299;
                    var $conv307 = (HEAP[$s_addr + 5816 | 0] & 65535) >> 8 & 255;
                    var $pending308 = $s_addr + 20 | 0;
                    var $195 = HEAP[$pending308];
                    var $inc309 = $195 + 1 | 0;
                    HEAP[$pending308] = $inc309;
                    var $arrayidx311 = HEAP[$s_addr + 8 | 0] + $195 | 0;
                    HEAP[$arrayidx311] = $conv307;
                    var $conv317 = ($val282 & 65535 & 65535) >> 16 - HEAP[$s_addr + 5820 | 0] & 65535;
                    HEAP[$s_addr + 5816 | 0] = $conv317;
                    var $bi_valid320 = $s_addr + 5820 | 0;
                    var $add321 = $len271 - 16 + HEAP[$bi_valid320] | 0;
                    HEAP[$bi_valid320] = $add321;
                  } else {
                    var $bi_buf330 = $s_addr + 5816 | 0;
                    var $conv333 = (HEAP[$bi_buf330] & 65535 | $conv287 << HEAP[$s_addr + 5820 | 0]) & 65535;
                    HEAP[$bi_buf330] = $conv333;
                    var $bi_valid334 = $s_addr + 5820 | 0;
                    var $add335 = HEAP[$bi_valid334] + $len271 | 0;
                    HEAP[$bi_valid334] = $add335;
                  }
                  $len337 = 3;
                  var $sub344 = $count - 3 | 0;
                  if ((HEAP[$s_addr + 5820 | 0] | 0) > (16 - $len337 | 0)) {
                    $val343 = $sub344;
                    var $bi_buf349 = $s_addr + 5816 | 0;
                    var $conv352 = (HEAP[$bi_buf349] & 65535 | ($val343 & 65535 & 65535) << HEAP[$s_addr + 5820 | 0]) & 65535;
                    HEAP[$bi_buf349] = $conv352;
                    var $conv356 = HEAP[$s_addr + 5816 | 0] & 65535 & 255 & 255;
                    var $pending357 = $s_addr + 20 | 0;
                    var $224 = HEAP[$pending357];
                    var $inc358 = $224 + 1 | 0;
                    HEAP[$pending357] = $inc358;
                    var $arrayidx360 = HEAP[$s_addr + 8 | 0] + $224 | 0;
                    HEAP[$arrayidx360] = $conv356;
                    var $conv364 = (HEAP[$s_addr + 5816 | 0] & 65535) >> 8 & 255;
                    var $pending365 = $s_addr + 20 | 0;
                    var $230 = HEAP[$pending365];
                    var $inc366 = $230 + 1 | 0;
                    HEAP[$pending365] = $inc366;
                    var $arrayidx368 = HEAP[$s_addr + 8 | 0] + $230 | 0;
                    HEAP[$arrayidx368] = $conv364;
                    var $conv374 = ($val343 & 65535 & 65535) >> 16 - HEAP[$s_addr + 5820 | 0] & 65535;
                    HEAP[$s_addr + 5816 | 0] = $conv374;
                    var $bi_valid377 = $s_addr + 5820 | 0;
                    var $add378 = $len337 - 16 + HEAP[$bi_valid377] | 0;
                    HEAP[$bi_valid377] = $add378;
                  } else {
                    var $bi_buf385 = $s_addr + 5816 | 0;
                    var $conv388 = (HEAP[$bi_buf385] & 65535 | ($sub344 & 65535 & 65535) << HEAP[$s_addr + 5820 | 0]) & 65535;
                    HEAP[$bi_buf385] = $conv388;
                    var $bi_valid389 = $s_addr + 5820 | 0;
                    var $add390 = HEAP[$bi_valid389] + $len337 | 0;
                    HEAP[$bi_valid389] = $add390;
                  }
                } else {
                  $len393 = HEAP[$bl_tree272 + 74 | 0] & 65535;
                  var $conv409 = HEAP[$s_addr + 2756 | 0] & 65535;
                  if ((HEAP[$s_addr + 5820 | 0] | 0) > (16 - $len393 | 0)) {
                    $val404 = $conv409;
                    var $bi_buf414 = $s_addr + 5816 | 0;
                    var $conv417 = (HEAP[$bi_buf414] & 65535 | ($val404 & 65535 & 65535) << HEAP[$s_addr + 5820 | 0]) & 65535;
                    HEAP[$bi_buf414] = $conv417;
                    var $conv421 = HEAP[$s_addr + 5816 | 0] & 65535 & 255 & 255;
                    var $pending422 = $s_addr + 20 | 0;
                    var $261 = HEAP[$pending422];
                    var $inc423 = $261 + 1 | 0;
                    HEAP[$pending422] = $inc423;
                    var $arrayidx425 = HEAP[$s_addr + 8 | 0] + $261 | 0;
                    HEAP[$arrayidx425] = $conv421;
                    var $conv429 = (HEAP[$s_addr + 5816 | 0] & 65535) >> 8 & 255;
                    var $pending430 = $s_addr + 20 | 0;
                    var $267 = HEAP[$pending430];
                    var $inc431 = $267 + 1 | 0;
                    HEAP[$pending430] = $inc431;
                    var $arrayidx433 = HEAP[$s_addr + 8 | 0] + $267 | 0;
                    HEAP[$arrayidx433] = $conv429;
                    var $conv439 = ($val404 & 65535 & 65535) >> 16 - HEAP[$s_addr + 5820 | 0] & 65535;
                    HEAP[$s_addr + 5816 | 0] = $conv439;
                    var $bi_valid442 = $s_addr + 5820 | 0;
                    var $add443 = $len393 - 16 + HEAP[$bi_valid442] | 0;
                    HEAP[$bi_valid442] = $add443;
                  } else {
                    var $bi_buf452 = $s_addr + 5816 | 0;
                    var $conv455 = (HEAP[$bi_buf452] & 65535 | $conv409 << HEAP[$s_addr + 5820 | 0]) & 65535;
                    HEAP[$bi_buf452] = $conv455;
                    var $bi_valid456 = $s_addr + 5820 | 0;
                    var $add457 = HEAP[$bi_valid456] + $len393 | 0;
                    HEAP[$bi_valid456] = $add457;
                  }
                  $len459 = 7;
                  var $sub466 = $count - 11 | 0;
                  if ((HEAP[$s_addr + 5820 | 0] | 0) > (16 - $len459 | 0)) {
                    $val465 = $sub466;
                    var $bi_buf471 = $s_addr + 5816 | 0;
                    var $conv474 = (HEAP[$bi_buf471] & 65535 | ($val465 & 65535 & 65535) << HEAP[$s_addr + 5820 | 0]) & 65535;
                    HEAP[$bi_buf471] = $conv474;
                    var $conv478 = HEAP[$s_addr + 5816 | 0] & 65535 & 255 & 255;
                    var $pending479 = $s_addr + 20 | 0;
                    var $296 = HEAP[$pending479];
                    var $inc480 = $296 + 1 | 0;
                    HEAP[$pending479] = $inc480;
                    var $arrayidx482 = HEAP[$s_addr + 8 | 0] + $296 | 0;
                    HEAP[$arrayidx482] = $conv478;
                    var $conv486 = (HEAP[$s_addr + 5816 | 0] & 65535) >> 8 & 255;
                    var $pending487 = $s_addr + 20 | 0;
                    var $302 = HEAP[$pending487];
                    var $inc488 = $302 + 1 | 0;
                    HEAP[$pending487] = $inc488;
                    var $arrayidx490 = HEAP[$s_addr + 8 | 0] + $302 | 0;
                    HEAP[$arrayidx490] = $conv486;
                    var $conv496 = ($val465 & 65535 & 65535) >> 16 - HEAP[$s_addr + 5820 | 0] & 65535;
                    HEAP[$s_addr + 5816 | 0] = $conv496;
                    var $bi_valid499 = $s_addr + 5820 | 0;
                    var $add500 = $len459 - 16 + HEAP[$bi_valid499] | 0;
                    HEAP[$bi_valid499] = $add500;
                  } else {
                    var $bi_buf507 = $s_addr + 5816 | 0;
                    var $conv510 = (HEAP[$bi_buf507] & 65535 | ($sub466 & 65535 & 65535) << HEAP[$s_addr + 5820 | 0]) & 65535;
                    HEAP[$bi_buf507] = $conv510;
                    var $bi_valid511 = $s_addr + 5820 | 0;
                    var $add512 = HEAP[$bi_valid511] + $len459 | 0;
                    HEAP[$bi_valid511] = $add512;
                  }
                }
              }
            }
          } while (0);
          $count = 0;
          $prevlen = $curlen;
          if (($nextlen | 0) == 0) {
            $max_count = 138;
            $min_count = 3;
          } else {
            if (($curlen | 0) == ($nextlen | 0)) {
              $max_count = 6;
              $min_count = 3;
            } else {
              $max_count = 7;
              $min_count = 4;
            }
          }
        }
        var $inc528 = $n + 1 | 0;
        $n = $inc528;
        if (!(($n | 0) <= ($max_code_addr | 0))) {
          break $for_body$$for_end$5;
        }
      }
    }
  } while (0);
  return;
  return;
}

_send_tree["X"] = 1;

function _bi_reverse($code, $len) {
  var $code_addr;
  var $len_addr;
  var $res;
  $code_addr = $code;
  $len_addr = $len;
  $res = 0;
  while (1) {
    var $or = $res | $code_addr & 1;
    $res = $or;
    var $shr = $code_addr >>> 1;
    $code_addr = $shr;
    var $shl = $res << 1;
    $res = $shl;
    var $dec = $len_addr - 1 | 0;
    $len_addr = $dec;
    if (($dec | 0) <= 0) {
      break;
    }
  }
  return $res >>> 1;
  return null;
}

function _scan_tree($s, $tree, $max_code) {
  var __label__;
  var $s_addr;
  var $tree_addr;
  var $max_code_addr;
  var $n;
  var $prevlen;
  var $curlen;
  var $nextlen;
  var $count;
  var $max_count;
  var $min_count;
  $s_addr = $s;
  $tree_addr = $tree;
  $max_code_addr = $max_code;
  $prevlen = -1;
  $nextlen = HEAP[$tree_addr + 2 | 0] & 65535;
  $count = 0;
  $max_count = 7;
  $min_count = 4;
  if (($nextlen | 0) == 0) {
    $max_count = 138;
    $min_count = 3;
  }
  HEAP[($max_code_addr + 1 << 2) + $tree_addr + 2 | 0] = -1;
  $n = 0;
  var $cmp51 = ($n | 0) <= ($max_code_addr | 0);
  $for_body$$for_end$5 : do {
    if ($cmp51) {
      while (1) {
        $curlen = $nextlen;
        $nextlen = HEAP[($n + 1 << 2) + $tree_addr + 2 | 0] & 65535;
        var $inc = $count + 1 | 0;
        $count = $inc;
        var $cmp12 = ($inc | 0) < ($max_count | 0);
        do {
          if ($cmp12) {
            if (($curlen | 0) == ($nextlen | 0)) {
              __label__ = 19;
              break;
            }
            __label__ = 5;
            break;
          } else {
            __label__ = 5;
          }
        } while (0);
        if (__label__ == 5) {
          if (($count | 0) < ($min_count | 0)) {
            var $freq = ($curlen << 2) + $s_addr + 2684 | 0;
            var $conv23 = (HEAP[$freq] & 65535) + $count & 65535;
            HEAP[$freq] = $conv23;
          } else {
            if (($curlen | 0) != 0) {
              if (($curlen | 0) != ($prevlen | 0)) {
                var $freq34 = ($curlen << 2) + $s_addr + 2684 | 0;
                var $inc35 = HEAP[$freq34] + 1 & 65535;
                HEAP[$freq34] = $inc35;
              }
              var $freq40 = $s_addr + 2748 | 0;
              var $inc41 = HEAP[$freq40] + 1 & 65535;
              HEAP[$freq40] = $inc41;
            } else {
              var $bl_tree46 = $s_addr + 2684 | 0;
              if (($count | 0) <= 10) {
                var $freq49 = $bl_tree46 + 68 | 0;
                var $inc50 = HEAP[$freq49] + 1 & 65535;
                HEAP[$freq49] = $inc50;
              } else {
                var $freq55 = $bl_tree46 + 72 | 0;
                var $inc56 = HEAP[$freq55] + 1 & 65535;
                HEAP[$freq55] = $inc56;
              }
            }
          }
          $count = 0;
          $prevlen = $curlen;
          if (($nextlen | 0) == 0) {
            $max_count = 138;
            $min_count = 3;
          } else {
            if (($curlen | 0) == ($nextlen | 0)) {
              $max_count = 6;
              $min_count = 3;
            } else {
              $max_count = 7;
              $min_count = 4;
            }
          }
        }
        var $inc71 = $n + 1 | 0;
        $n = $inc71;
        if (!(($n | 0) <= ($max_code_addr | 0))) {
          break $for_body$$for_end$5;
        }
      }
    }
  } while (0);
  return;
  return;
}

_scan_tree["X"] = 1;

function _pqdownheap($s, $tree, $k) {
  var $s_addr;
  var $tree_addr;
  var $k_addr;
  var $v;
  var $j;
  $s_addr = $s;
  $tree_addr = $tree;
  $k_addr = $k;
  $v = HEAP[($k_addr << 2) + $s_addr + 2908 | 0];
  $j = $k_addr << 1;
  while (1) {
    if (!(($j | 0) <= (HEAP[$s_addr + 5200 | 0] | 0))) {
      break;
    }
    var $cmp2 = ($j | 0) < (HEAP[$s_addr + 5200 | 0] | 0);
    do {
      if ($cmp2) {
        if ((HEAP[(HEAP[($j + 1 << 2) + $s_addr + 2908 | 0] << 2) + $tree_addr | 0] & 65535 | 0) >= (HEAP[(HEAP[($j << 2) + $s_addr + 2908 | 0] << 2) + $tree_addr | 0] & 65535 | 0)) {
          if ((HEAP[(HEAP[($j + 1 << 2) + $s_addr + 2908 | 0] << 2) + $tree_addr | 0] & 65535 | 0) != (HEAP[(HEAP[($j << 2) + $s_addr + 2908 | 0] << 2) + $tree_addr | 0] & 65535 | 0)) {
            break;
          }
          if (!((HEAP[$s_addr + HEAP[($j + 1 << 2) + $s_addr + 2908 | 0] + 5208 | 0] & 255 | 0) <= (HEAP[$s_addr + HEAP[($j << 2) + $s_addr + 2908 | 0] + 5208 | 0] & 255 | 0))) {
            break;
          }
        }
        var $inc = $j + 1 | 0;
        $j = $inc;
      }
    } while (0);
    if ((HEAP[($v << 2) + $tree_addr | 0] & 65535 | 0) < (HEAP[(HEAP[($j << 2) + $s_addr + 2908 | 0] << 2) + $tree_addr | 0] & 65535 | 0)) {
      break;
    }
    if ((HEAP[($v << 2) + $tree_addr | 0] & 65535 | 0) == (HEAP[(HEAP[($j << 2) + $s_addr + 2908 | 0] << 2) + $tree_addr | 0] & 65535 | 0)) {
      if ((HEAP[$v + ($s_addr + 5208) | 0] & 255 | 0) <= (HEAP[$s_addr + HEAP[($j << 2) + $s_addr + 2908 | 0] + 5208 | 0] & 255 | 0)) {
        break;
      }
    }
    var $67 = HEAP[($j << 2) + $s_addr + 2908 | 0];
    HEAP[($k_addr << 2) + $s_addr + 2908 | 0] = $67;
    $k_addr = $j;
    var $shl84 = $j << 1;
    $j = $shl84;
  }
  HEAP[($k_addr << 2) + $s_addr + 2908 | 0] = $v;
  return;
  return;
}

_pqdownheap["X"] = 1;

function _gen_bitlen($s, $desc) {
  var $s_addr;
  var $desc_addr;
  var $tree;
  var $max_code;
  var $stree;
  var $extra;
  var $base;
  var $max_length;
  var $h;
  var $n;
  var $m;
  var $bits;
  var $xbits;
  var $f;
  var $overflow;
  $s_addr = $s;
  $desc_addr = $desc;
  $tree = HEAP[$desc_addr | 0];
  $max_code = HEAP[$desc_addr + 4 | 0];
  $stree = HEAP[HEAP[$desc_addr + 8 | 0] | 0];
  $extra = HEAP[HEAP[$desc_addr + 8 | 0] + 4 | 0];
  $base = HEAP[HEAP[$desc_addr + 8 | 0] + 8 | 0];
  $max_length = HEAP[HEAP[$desc_addr + 8 | 0] + 16 | 0];
  $overflow = 0;
  $bits = 0;
  while (1) {
    HEAP[($bits << 1) + $s_addr + 2876 | 0] = 0;
    var $inc = $bits + 1 | 0;
    $bits = $inc;
    if (!(($inc | 0) <= 15)) {
      break;
    }
  }
  var $len = (HEAP[(HEAP[$s_addr + 5204 | 0] << 2) + $s_addr + 2908 | 0] << 2) + $tree + 2 | 0;
  HEAP[$len] = 0;
  var $add = HEAP[$s_addr + 5204 | 0] + 1 | 0;
  $h = $add;
  var $cmp107 = ($add | 0) < 573;
  $for_body11$$for_end55$53 : do {
    if ($cmp107) {
      while (1) {
        $n = HEAP[($h << 2) + $s_addr + 2908 | 0];
        $bits = (HEAP[((HEAP[($n << 2) + $tree + 2 | 0] & 65535) << 2) + $tree + 2 | 0] & 65535) + 1 | 0;
        if (($bits | 0) > ($max_length | 0)) {
          $bits = $max_length;
          var $inc22 = $overflow + 1 | 0;
          $overflow = $inc22;
        }
        HEAP[($n << 2) + $tree + 2 | 0] = $bits & 65535;
        var $cmp27 = ($n | 0) > ($max_code | 0);
        do {
          if (!$cmp27) {
            var $arrayidx32 = ($bits << 1) + $s_addr + 2876 | 0;
            var $inc33 = HEAP[$arrayidx32] + 1 & 65535;
            HEAP[$arrayidx32] = $inc33;
            $xbits = 0;
            if (($n | 0) >= ($base | 0)) {
              $xbits = HEAP[($n - $base << 2) + $extra | 0];
            }
            $f = HEAP[($n << 2) + $tree | 0];
            var $opt_len = $s_addr + 5800 | 0;
            var $add42 = HEAP[$opt_len] + ($xbits + $bits) * ($f & 65535) | 0;
            HEAP[$opt_len] = $add42;
            if (($stree | 0) == 0) {
              break;
            }
            var $static_len = $s_addr + 5804 | 0;
            var $add51 = HEAP[$static_len] + ((HEAP[($n << 2) + $stree + 2 | 0] & 65535) + $xbits) * ($f & 65535) | 0;
            HEAP[$static_len] = $add51;
          }
        } while (0);
        var $inc54 = $h + 1 | 0;
        $h = $inc54;
        if (($inc54 | 0) >= 573) {
          break $for_body11$$for_end55$53;
        }
      }
    }
  } while (0);
  var $cmp56 = ($overflow | 0) == 0;
  $for_end127$$do_body$67 : do {
    if (!$cmp56) {
      while (1) {
        $bits = $max_length - 1 | 0;
        var $cmp646 = (HEAP[($bits << 1) + $s_addr + 2876 | 0] & 65535 | 0) == 0;
        var $74 = $bits;
        $while_body$$while_end$70 : do {
          if ($cmp646) {
            var $75 = $74;
            while (1) {
              var $75;
              $bits = $75 - 1 | 0;
              var $79 = $bits;
              if ((HEAP[($bits << 1) + $s_addr + 2876 | 0] & 65535 | 0) != 0) {
                var $_lcssa = $79;
                break $while_body$$while_end$70;
              }
              var $75 = $79;
            }
          } else {
            var $_lcssa = $74;
          }
        } while (0);
        var $_lcssa;
        var $arrayidx67 = ($_lcssa << 1) + $s_addr + 2876 | 0;
        var $dec68 = HEAP[$arrayidx67] - 1 & 65535;
        HEAP[$arrayidx67] = $dec68;
        var $arrayidx71 = ($bits + 1 << 1) + $s_addr + 2876 | 0;
        var $conv74 = (HEAP[$arrayidx71] & 65535) + 2 & 65535;
        HEAP[$arrayidx71] = $conv74;
        var $arrayidx76 = ($max_length << 1) + $s_addr + 2876 | 0;
        var $dec77 = HEAP[$arrayidx76] - 1 & 65535;
        HEAP[$arrayidx76] = $dec77;
        var $sub78 = $overflow - 2 | 0;
        $overflow = $sub78;
        if (($sub78 | 0) <= 0) {
          break;
        }
      }
      var $89 = $max_length;
      $bits = $89;
      if (($89 | 0) == 0) {
        break;
      }
      while (1) {
        var $conv87 = HEAP[($bits << 1) + $s_addr + 2876 | 0] & 65535;
        $n = $conv87;
        var $cmp891 = ($conv87 | 0) != 0;
        $while_body91$$for_inc125$77 : do {
          if ($cmp891) {
            while (1) {
              var $dec92 = $h - 1 | 0;
              $h = $dec92;
              $m = HEAP[($dec92 << 2) + $s_addr + 2908 | 0];
              if (($m | 0) > ($max_code | 0)) {
                var $_be = $n;
              } else {
                if ((HEAP[($m << 2) + $tree + 2 | 0] & 65535 | 0) != ($bits | 0)) {
                  var $opt_len116 = $s_addr + 5800 | 0;
                  var $add117 = HEAP[$opt_len116] + (HEAP[($m << 2) + $tree | 0] & 65535) * ($bits - (HEAP[($m << 2) + $tree + 2 | 0] & 65535)) | 0;
                  HEAP[$opt_len116] = $add117;
                  HEAP[($m << 2) + $tree + 2 | 0] = $bits & 65535;
                }
                var $dec123 = $n - 1 | 0;
                $n = $dec123;
                var $_be = $dec123;
              }
              var $_be;
              if (($_be | 0) == 0) {
                break $while_body91$$for_inc125$77;
              }
            }
          }
        } while (0);
        var $dec126 = $bits - 1 | 0;
        $bits = $dec126;
        if (($dec126 | 0) == 0) {
          break $for_end127$$do_body$67;
        }
      }
    }
  } while (0);
  return;
  return;
}

_gen_bitlen["X"] = 1;

function _gen_codes($tree, $max_code, $bl_count) {
  var __stackBase__ = STACKTOP;
  STACKTOP += 32;
  var $tree_addr;
  var $max_code_addr;
  var $bl_count_addr;
  var $next_code = __stackBase__;
  var $code;
  var $bits;
  var $n;
  var $len;
  $tree_addr = $tree;
  $max_code_addr = $max_code;
  $bl_count_addr = $bl_count;
  $code = 0;
  $bits = 1;
  while (1) {
    var $conv2 = (HEAP[($bits - 1 << 1) + $bl_count_addr | 0] & 65535) + ($code & 65535) << 1 & 65535;
    $code = $conv2;
    HEAP[($bits << 1) + $next_code | 0] = $conv2;
    var $inc = $bits + 1 | 0;
    $bits = $inc;
    if (!(($inc | 0) <= 15)) {
      break;
    }
  }
  $n = 0;
  var $cmp51 = ($n | 0) <= ($max_code_addr | 0);
  $for_body7$$for_end21$93 : do {
    if ($cmp51) {
      while (1) {
        var $conv10 = HEAP[($n << 2) + $tree_addr + 2 | 0] & 65535;
        $len = $conv10;
        if (($conv10 | 0) != 0) {
          var $arrayidx13 = ($len << 1) + $next_code | 0;
          var $12 = HEAP[$arrayidx13];
          var $inc14 = $12 + 1 & 65535;
          HEAP[$arrayidx13] = $inc14;
          var $conv15 = $12 & 65535;
          var $call = _bi_reverse($conv15, $len);
          var $conv16 = $call & 65535;
          HEAP[($n << 2) + $tree_addr | 0] = $conv16;
        }
        var $inc20 = $n + 1 | 0;
        $n = $inc20;
        if (!(($n | 0) <= ($max_code_addr | 0))) {
          break $for_body7$$for_end21$93;
        }
      }
    }
  } while (0);
  STACKTOP = __stackBase__;
  return;
  return;
}

_gen_codes["X"] = 1;

function _adler32($adler, $buf, $len) {
  var __label__;
  var $retval;
  var $adler_addr;
  var $buf_addr;
  var $len_addr;
  var $sum2;
  var $n;
  $adler_addr = $adler;
  $buf_addr = $buf;
  $len_addr = $len;
  $sum2 = $adler_addr >>> 16 & 65535;
  var $and1 = $adler_addr & 65535;
  $adler_addr = $and1;
  var $3 = $buf_addr;
  if (($len_addr | 0) == 1) {
    var $add = $adler_addr + (HEAP[$3 | 0] & 255) | 0;
    $adler_addr = $add;
    if ($adler_addr >>> 0 >= 65521) {
      var $sub = $adler_addr - 65521 | 0;
      $adler_addr = $sub;
    }
    var $add5 = $sum2 + $adler_addr | 0;
    $sum2 = $add5;
    if ($add5 >>> 0 >= 65521) {
      var $sub9 = $sum2 - 65521 | 0;
      $sum2 = $sub9;
    }
    $retval = $sum2 << 16 | $adler_addr;
  } else {
    if (($3 | 0) == 0) {
      $retval = 1;
    } else {
      var $13 = $len_addr;
      if ($13 >>> 0 < 16) {
        var $dec9 = $13 - 1 | 0;
        $len_addr = $dec9;
        var $tobool10 = ($13 | 0) != 0;
        $while_body$$while_end$16 : do {
          if ($tobool10) {
            while (1) {
              var $14 = $buf_addr;
              var $incdec_ptr = $14 + 1 | 0;
              $buf_addr = $incdec_ptr;
              var $add20 = $adler_addr + (HEAP[$14] & 255) | 0;
              $adler_addr = $add20;
              var $add21 = $sum2 + $adler_addr | 0;
              $sum2 = $add21;
              var $_pr = $len_addr;
              var $dec = $_pr - 1 | 0;
              $len_addr = $dec;
              if (($_pr | 0) == 0) {
                break $while_body$$while_end$16;
              }
            }
          }
        } while (0);
        if ($adler_addr >>> 0 >= 65521) {
          var $sub25 = $adler_addr - 65521 | 0;
          $adler_addr = $sub25;
        }
        var $rem = ($sum2 >>> 0) % 65521;
        $sum2 = $rem;
        $retval = $sum2 << 16 | $adler_addr;
      } else {
        var $cmp317 = $13 >>> 0 >= 5552;
        do {
          if ($cmp317) {
            var $24 = $13;
            while (1) {
              var $24;
              $len_addr = $24 - 5552 | 0;
              $n = 347;
              while (1) {
                var $add37 = $adler_addr + (HEAP[$buf_addr | 0] & 255) | 0;
                $adler_addr = $add37;
                var $add38 = $sum2 + $adler_addr | 0;
                $sum2 = $add38;
                var $add41 = $adler_addr + (HEAP[$buf_addr + 1 | 0] & 255) | 0;
                $adler_addr = $add41;
                var $add42 = $sum2 + $adler_addr | 0;
                $sum2 = $add42;
                var $add45 = $adler_addr + (HEAP[$buf_addr + 2 | 0] & 255) | 0;
                $adler_addr = $add45;
                var $add46 = $sum2 + $adler_addr | 0;
                $sum2 = $add46;
                var $add49 = $adler_addr + (HEAP[$buf_addr + 3 | 0] & 255) | 0;
                $adler_addr = $add49;
                var $add50 = $sum2 + $adler_addr | 0;
                $sum2 = $add50;
                var $add53 = $adler_addr + (HEAP[$buf_addr + 4 | 0] & 255) | 0;
                $adler_addr = $add53;
                var $add54 = $sum2 + $adler_addr | 0;
                $sum2 = $add54;
                var $add57 = $adler_addr + (HEAP[$buf_addr + 5 | 0] & 255) | 0;
                $adler_addr = $add57;
                var $add58 = $sum2 + $adler_addr | 0;
                $sum2 = $add58;
                var $add61 = $adler_addr + (HEAP[$buf_addr + 6 | 0] & 255) | 0;
                $adler_addr = $add61;
                var $add62 = $sum2 + $adler_addr | 0;
                $sum2 = $add62;
                var $add65 = $adler_addr + (HEAP[$buf_addr + 7 | 0] & 255) | 0;
                $adler_addr = $add65;
                var $add66 = $sum2 + $adler_addr | 0;
                $sum2 = $add66;
                var $add69 = $adler_addr + (HEAP[$buf_addr + 8 | 0] & 255) | 0;
                $adler_addr = $add69;
                var $add70 = $sum2 + $adler_addr | 0;
                $sum2 = $add70;
                var $add73 = $adler_addr + (HEAP[$buf_addr + 9 | 0] & 255) | 0;
                $adler_addr = $add73;
                var $add74 = $sum2 + $adler_addr | 0;
                $sum2 = $add74;
                var $add77 = $adler_addr + (HEAP[$buf_addr + 10 | 0] & 255) | 0;
                $adler_addr = $add77;
                var $add78 = $sum2 + $adler_addr | 0;
                $sum2 = $add78;
                var $add81 = $adler_addr + (HEAP[$buf_addr + 11 | 0] & 255) | 0;
                $adler_addr = $add81;
                var $add82 = $sum2 + $adler_addr | 0;
                $sum2 = $add82;
                var $add85 = $adler_addr + (HEAP[$buf_addr + 12 | 0] & 255) | 0;
                $adler_addr = $add85;
                var $add86 = $sum2 + $adler_addr | 0;
                $sum2 = $add86;
                var $add89 = $adler_addr + (HEAP[$buf_addr + 13 | 0] & 255) | 0;
                $adler_addr = $add89;
                var $add90 = $sum2 + $adler_addr | 0;
                $sum2 = $add90;
                var $add93 = $adler_addr + (HEAP[$buf_addr + 14 | 0] & 255) | 0;
                $adler_addr = $add93;
                var $add94 = $sum2 + $adler_addr | 0;
                $sum2 = $add94;
                var $add97 = $adler_addr + (HEAP[$buf_addr + 15 | 0] & 255) | 0;
                $adler_addr = $add97;
                var $add98 = $sum2 + $adler_addr | 0;
                $sum2 = $add98;
                var $add_ptr = $buf_addr + 16 | 0;
                $buf_addr = $add_ptr;
                var $dec99 = $n - 1 | 0;
                $n = $dec99;
                if (($dec99 | 0) == 0) {
                  break;
                }
              }
              var $rem101 = ($adler_addr >>> 0) % 65521;
              $adler_addr = $rem101;
              var $rem102 = ($sum2 >>> 0) % 65521;
              $sum2 = $rem102;
              var $_pr1 = $len_addr;
              if (!($_pr1 >>> 0 >= 5552)) {
                break;
              }
              var $24 = $_pr1;
            }
            if (($_pr1 | 0) != 0) {
              __label__ = 19;
              break;
            }
            __label__ = 24;
            break;
          } else {
            __label__ = 19;
          }
        } while (0);
        if (__label__ == 19) {
          var $109 = $len_addr;
          var $cmp1075 = $109 >>> 0 >= 16;
          $while_body109$$while_cond177_preheader$33 : do {
            if ($cmp1075) {
              while (1) {
                var $sub110 = $len_addr - 16 | 0;
                $len_addr = $sub110;
                var $add113 = $adler_addr + (HEAP[$buf_addr | 0] & 255) | 0;
                $adler_addr = $add113;
                var $add114 = $sum2 + $adler_addr | 0;
                $sum2 = $add114;
                var $add117 = $adler_addr + (HEAP[$buf_addr + 1 | 0] & 255) | 0;
                $adler_addr = $add117;
                var $add118 = $sum2 + $adler_addr | 0;
                $sum2 = $add118;
                var $add121 = $adler_addr + (HEAP[$buf_addr + 2 | 0] & 255) | 0;
                $adler_addr = $add121;
                var $add122 = $sum2 + $adler_addr | 0;
                $sum2 = $add122;
                var $add125 = $adler_addr + (HEAP[$buf_addr + 3 | 0] & 255) | 0;
                $adler_addr = $add125;
                var $add126 = $sum2 + $adler_addr | 0;
                $sum2 = $add126;
                var $add129 = $adler_addr + (HEAP[$buf_addr + 4 | 0] & 255) | 0;
                $adler_addr = $add129;
                var $add130 = $sum2 + $adler_addr | 0;
                $sum2 = $add130;
                var $add133 = $adler_addr + (HEAP[$buf_addr + 5 | 0] & 255) | 0;
                $adler_addr = $add133;
                var $add134 = $sum2 + $adler_addr | 0;
                $sum2 = $add134;
                var $add137 = $adler_addr + (HEAP[$buf_addr + 6 | 0] & 255) | 0;
                $adler_addr = $add137;
                var $add138 = $sum2 + $adler_addr | 0;
                $sum2 = $add138;
                var $add141 = $adler_addr + (HEAP[$buf_addr + 7 | 0] & 255) | 0;
                $adler_addr = $add141;
                var $add142 = $sum2 + $adler_addr | 0;
                $sum2 = $add142;
                var $add145 = $adler_addr + (HEAP[$buf_addr + 8 | 0] & 255) | 0;
                $adler_addr = $add145;
                var $add146 = $sum2 + $adler_addr | 0;
                $sum2 = $add146;
                var $add149 = $adler_addr + (HEAP[$buf_addr + 9 | 0] & 255) | 0;
                $adler_addr = $add149;
                var $add150 = $sum2 + $adler_addr | 0;
                $sum2 = $add150;
                var $add153 = $adler_addr + (HEAP[$buf_addr + 10 | 0] & 255) | 0;
                $adler_addr = $add153;
                var $add154 = $sum2 + $adler_addr | 0;
                $sum2 = $add154;
                var $add157 = $adler_addr + (HEAP[$buf_addr + 11 | 0] & 255) | 0;
                $adler_addr = $add157;
                var $add158 = $sum2 + $adler_addr | 0;
                $sum2 = $add158;
                var $add161 = $adler_addr + (HEAP[$buf_addr + 12 | 0] & 255) | 0;
                $adler_addr = $add161;
                var $add162 = $sum2 + $adler_addr | 0;
                $sum2 = $add162;
                var $add165 = $adler_addr + (HEAP[$buf_addr + 13 | 0] & 255) | 0;
                $adler_addr = $add165;
                var $add166 = $sum2 + $adler_addr | 0;
                $sum2 = $add166;
                var $add169 = $adler_addr + (HEAP[$buf_addr + 14 | 0] & 255) | 0;
                $adler_addr = $add169;
                var $add170 = $sum2 + $adler_addr | 0;
                $sum2 = $add170;
                var $add173 = $adler_addr + (HEAP[$buf_addr + 15 | 0] & 255) | 0;
                $adler_addr = $add173;
                var $add174 = $sum2 + $adler_addr | 0;
                $sum2 = $add174;
                var $add_ptr175 = $buf_addr + 16 | 0;
                $buf_addr = $add_ptr175;
                var $192 = $len_addr;
                if (!($192 >>> 0 >= 16)) {
                  var $_lcssa = $192;
                  break $while_body109$$while_cond177_preheader$33;
                }
              }
            } else {
              var $_lcssa = $109;
            }
          } while (0);
          var $_lcssa;
          $len_addr = $_lcssa - 1 | 0;
          var $tobool1794 = ($_lcssa | 0) != 0;
          $while_body180$$while_end185$37 : do {
            if ($tobool1794) {
              while (1) {
                var $193 = $buf_addr;
                var $incdec_ptr181 = $193 + 1 | 0;
                $buf_addr = $incdec_ptr181;
                var $add183 = $adler_addr + (HEAP[$193] & 255) | 0;
                $adler_addr = $add183;
                var $add184 = $sum2 + $adler_addr | 0;
                $sum2 = $add184;
                var $_pr2 = $len_addr;
                var $dec178 = $_pr2 - 1 | 0;
                $len_addr = $dec178;
                if (($_pr2 | 0) == 0) {
                  break $while_body180$$while_end185$37;
                }
              }
            }
          } while (0);
          var $rem186 = ($adler_addr >>> 0) % 65521;
          $adler_addr = $rem186;
          var $rem187 = ($sum2 >>> 0) % 65521;
          $sum2 = $rem187;
        }
        $retval = $sum2 << 16 | $adler_addr;
      }
    }
  }
  return $retval;
  return null;
}

_adler32["X"] = 1;

function _crc32_little($crc, $buf, $len) {
  var $crc_addr;
  var $buf_addr;
  var $len_addr;
  var $c;
  var $buf4;
  $crc_addr = $crc;
  $buf_addr = $buf;
  $len_addr = $len;
  $c = $crc_addr;
  var $neg = $c ^ -1;
  $c = $neg;
  var $2 = $len_addr;
  while (1) {
    var $2;
    if (($2 | 0) == 0) {
      break;
    }
    if (($buf_addr & 3 | 0) == 0) {
      break;
    }
    var $6 = $buf_addr;
    var $incdec_ptr = $6 + 1 | 0;
    $buf_addr = $incdec_ptr;
    var $xor3 = $c >>> 8 ^ HEAP[(((HEAP[$6] & 255 ^ $c) & 255) << 2) + _crc_table | 0];
    $c = $xor3;
    var $dec = $len_addr - 1 | 0;
    $len_addr = $dec;
    var $2 = $dec;
  }
  $buf4 = $buf_addr;
  var $_pr1 = $len_addr;
  var $cmp4 = $_pr1 >>> 0 >= 32;
  $while_body6$$while_cond128thread_pre_split$57 : do {
    if ($cmp4) {
      while (1) {
        var $13 = $buf4;
        var $incdec_ptr7 = $13 + 4 | 0;
        $buf4 = $incdec_ptr7;
        var $xor8 = $c ^ HEAP[$13];
        $c = $xor8;
        var $xor21 = HEAP[(($c >>> 8 & 255) << 2) + _crc_table + 2048 | 0] ^ HEAP[(($c & 255) << 2) + _crc_table + 3072 | 0] ^ HEAP[(($c >>> 16 & 255) << 2) + _crc_table + 1024 | 0] ^ HEAP[($c >>> 24 << 2) + _crc_table | 0];
        $c = $xor21;
        var $24 = $buf4;
        var $incdec_ptr22 = $24 + 4 | 0;
        $buf4 = $incdec_ptr22;
        var $xor23 = $c ^ HEAP[$24];
        $c = $xor23;
        var $xor36 = HEAP[(($c >>> 8 & 255) << 2) + _crc_table + 2048 | 0] ^ HEAP[(($c & 255) << 2) + _crc_table + 3072 | 0] ^ HEAP[(($c >>> 16 & 255) << 2) + _crc_table + 1024 | 0] ^ HEAP[($c >>> 24 << 2) + _crc_table | 0];
        $c = $xor36;
        var $35 = $buf4;
        var $incdec_ptr37 = $35 + 4 | 0;
        $buf4 = $incdec_ptr37;
        var $xor38 = $c ^ HEAP[$35];
        $c = $xor38;
        var $xor51 = HEAP[(($c >>> 8 & 255) << 2) + _crc_table + 2048 | 0] ^ HEAP[(($c & 255) << 2) + _crc_table + 3072 | 0] ^ HEAP[(($c >>> 16 & 255) << 2) + _crc_table + 1024 | 0] ^ HEAP[($c >>> 24 << 2) + _crc_table | 0];
        $c = $xor51;
        var $46 = $buf4;
        var $incdec_ptr52 = $46 + 4 | 0;
        $buf4 = $incdec_ptr52;
        var $xor53 = $c ^ HEAP[$46];
        $c = $xor53;
        var $xor66 = HEAP[(($c >>> 8 & 255) << 2) + _crc_table + 2048 | 0] ^ HEAP[(($c & 255) << 2) + _crc_table + 3072 | 0] ^ HEAP[(($c >>> 16 & 255) << 2) + _crc_table + 1024 | 0] ^ HEAP[($c >>> 24 << 2) + _crc_table | 0];
        $c = $xor66;
        var $57 = $buf4;
        var $incdec_ptr67 = $57 + 4 | 0;
        $buf4 = $incdec_ptr67;
        var $xor68 = $c ^ HEAP[$57];
        $c = $xor68;
        var $xor81 = HEAP[(($c >>> 8 & 255) << 2) + _crc_table + 2048 | 0] ^ HEAP[(($c & 255) << 2) + _crc_table + 3072 | 0] ^ HEAP[(($c >>> 16 & 255) << 2) + _crc_table + 1024 | 0] ^ HEAP[($c >>> 24 << 2) + _crc_table | 0];
        $c = $xor81;
        var $68 = $buf4;
        var $incdec_ptr82 = $68 + 4 | 0;
        $buf4 = $incdec_ptr82;
        var $xor83 = $c ^ HEAP[$68];
        $c = $xor83;
        var $xor96 = HEAP[(($c >>> 8 & 255) << 2) + _crc_table + 2048 | 0] ^ HEAP[(($c & 255) << 2) + _crc_table + 3072 | 0] ^ HEAP[(($c >>> 16 & 255) << 2) + _crc_table + 1024 | 0] ^ HEAP[($c >>> 24 << 2) + _crc_table | 0];
        $c = $xor96;
        var $79 = $buf4;
        var $incdec_ptr97 = $79 + 4 | 0;
        $buf4 = $incdec_ptr97;
        var $xor98 = $c ^ HEAP[$79];
        $c = $xor98;
        var $xor111 = HEAP[(($c >>> 8 & 255) << 2) + _crc_table + 2048 | 0] ^ HEAP[(($c & 255) << 2) + _crc_table + 3072 | 0] ^ HEAP[(($c >>> 16 & 255) << 2) + _crc_table + 1024 | 0] ^ HEAP[($c >>> 24 << 2) + _crc_table | 0];
        $c = $xor111;
        var $90 = $buf4;
        var $incdec_ptr112 = $90 + 4 | 0;
        $buf4 = $incdec_ptr112;
        var $xor113 = $c ^ HEAP[$90];
        $c = $xor113;
        var $xor126 = HEAP[(($c >>> 8 & 255) << 2) + _crc_table + 2048 | 0] ^ HEAP[(($c & 255) << 2) + _crc_table + 3072 | 0] ^ HEAP[(($c >>> 16 & 255) << 2) + _crc_table + 1024 | 0] ^ HEAP[($c >>> 24 << 2) + _crc_table | 0];
        $c = $xor126;
        var $sub = $len_addr - 32 | 0;
        $len_addr = $sub;
        if (!($sub >>> 0 >= 32)) {
          var $_pr2 = $sub;
          break $while_body6$$while_cond128thread_pre_split$57;
        }
      }
    } else {
      var $_pr2 = $_pr1;
    }
  } while (0);
  var $_pr2;
  var $cmp1293 = $_pr2 >>> 0 >= 4;
  var $102 = $buf4;
  $while_body131$$while_end148thread_pre_split$61 : do {
    if ($cmp1293) {
      var $103 = $102;
      while (1) {
        var $103;
        $buf4 = $103 + 4 | 0;
        var $xor133 = $c ^ HEAP[$103];
        $c = $xor133;
        var $xor146 = HEAP[(($c >>> 8 & 255) << 2) + _crc_table + 2048 | 0] ^ HEAP[(($c & 255) << 2) + _crc_table + 3072 | 0] ^ HEAP[(($c >>> 16 & 255) << 2) + _crc_table + 1024 | 0] ^ HEAP[($c >>> 24 << 2) + _crc_table | 0];
        $c = $xor146;
        var $sub147 = $len_addr - 4 | 0;
        $len_addr = $sub147;
        var $115 = $buf4;
        if (!($sub147 >>> 0 >= 4)) {
          var $_lcssa = $115;
          var $116 = $sub147;
          break $while_body131$$while_end148thread_pre_split$61;
        }
        var $103 = $115;
      }
    } else {
      var $_lcssa = $102;
      var $116 = $len_addr;
    }
  } while (0);
  var $116;
  var $_lcssa;
  $buf_addr = $_lcssa;
  var $tobool149 = ($116 | 0) != 0;
  $do_body$$if_end$66 : do {
    if ($tobool149) {
      while (1) {
        var $119 = $buf_addr;
        var $incdec_ptr150 = $119 + 1 | 0;
        $buf_addr = $incdec_ptr150;
        var $xor156 = $c >>> 8 ^ HEAP[(((HEAP[$119] & 255 ^ $c) & 255) << 2) + _crc_table | 0];
        $c = $xor156;
        var $dec157 = $len_addr - 1 | 0;
        $len_addr = $dec157;
        if (($dec157 | 0) == 0) {
          break $do_body$$if_end$66;
        }
      }
    }
  } while (0);
  var $neg159 = $c ^ -1;
  $c = $neg159;
  return $c;
  return null;
}

_crc32_little["X"] = 1;

function _crc32($crc, $buf, $len) {
  var __stackBase__ = STACKTOP;
  STACKTOP += 4;
  var $retval;
  var $crc_addr;
  var $buf_addr;
  var $len_addr;
  var $endian = __stackBase__;
  $crc_addr = $crc;
  $buf_addr = $buf;
  $len_addr = $len;
  if (($buf_addr | 0) == 0) {
    $retval = 0;
  } else {
    HEAP[$endian] = 1;
    var $3 = $crc_addr;
    var $4 = $buf_addr;
    var $5 = $len_addr;
    if (HEAP[$endian] << 24 >> 24 != 0) {
      var $call = _crc32_little($3, $4, $5);
      $retval = $call;
    } else {
      var $call2 = _crc32_big($3, $4, $5);
      $retval = $call2;
    }
  }
  STACKTOP = __stackBase__;
  return $retval;
  return null;
}

function _crc32_big($crc, $buf, $len) {
  var $crc_addr;
  var $buf_addr;
  var $len_addr;
  var $c;
  var $buf4;
  $crc_addr = $crc;
  $buf_addr = $buf;
  $len_addr = $len;
  $c = (($crc_addr & 65280) << 8) + (($crc_addr & 255) << 24) + ($crc_addr >>> 8 & 65280) + ($crc_addr >>> 24 & 255) | 0;
  var $neg = $c ^ -1;
  $c = $neg;
  var $5 = $len_addr;
  while (1) {
    var $5;
    if (($5 | 0) == 0) {
      break;
    }
    if (($buf_addr & 3 | 0) == 0) {
      break;
    }
    var $9 = $buf_addr;
    var $incdec_ptr = $9 + 1 | 0;
    $buf_addr = $incdec_ptr;
    var $xor12 = $c << 8 ^ HEAP[((HEAP[$9] & 255 ^ $c >>> 24) << 2) + _crc_table + 4096 | 0];
    $c = $xor12;
    var $dec = $len_addr - 1 | 0;
    $len_addr = $dec;
    var $5 = $dec;
  }
  $buf4 = $buf_addr;
  var $incdec_ptr13 = $buf4 - 4 | 0;
  $buf4 = $incdec_ptr13;
  var $_pr1 = $len_addr;
  var $cmp6 = $_pr1 >>> 0 >= 32;
  $while_body16$$while_cond138thread_pre_split$7 : do {
    if ($cmp6) {
      while (1) {
        var $incdec_ptr17 = $buf4 + 4 | 0;
        $buf4 = $incdec_ptr17;
        var $xor18 = $c ^ HEAP[$incdec_ptr17];
        $c = $xor18;
        var $xor31 = HEAP[(($c >>> 8 & 255) << 2) + _crc_table + 5120 | 0] ^ HEAP[(($c & 255) << 2) + _crc_table + 4096 | 0] ^ HEAP[(($c >>> 16 & 255) << 2) + _crc_table + 6144 | 0] ^ HEAP[($c >>> 24 << 2) + _crc_table + 7168 | 0];
        $c = $xor31;
        var $incdec_ptr32 = $buf4 + 4 | 0;
        $buf4 = $incdec_ptr32;
        var $xor33 = $c ^ HEAP[$incdec_ptr32];
        $c = $xor33;
        var $xor46 = HEAP[(($c >>> 8 & 255) << 2) + _crc_table + 5120 | 0] ^ HEAP[(($c & 255) << 2) + _crc_table + 4096 | 0] ^ HEAP[(($c >>> 16 & 255) << 2) + _crc_table + 6144 | 0] ^ HEAP[($c >>> 24 << 2) + _crc_table + 7168 | 0];
        $c = $xor46;
        var $incdec_ptr47 = $buf4 + 4 | 0;
        $buf4 = $incdec_ptr47;
        var $xor48 = $c ^ HEAP[$incdec_ptr47];
        $c = $xor48;
        var $xor61 = HEAP[(($c >>> 8 & 255) << 2) + _crc_table + 5120 | 0] ^ HEAP[(($c & 255) << 2) + _crc_table + 4096 | 0] ^ HEAP[(($c >>> 16 & 255) << 2) + _crc_table + 6144 | 0] ^ HEAP[($c >>> 24 << 2) + _crc_table + 7168 | 0];
        $c = $xor61;
        var $incdec_ptr62 = $buf4 + 4 | 0;
        $buf4 = $incdec_ptr62;
        var $xor63 = $c ^ HEAP[$incdec_ptr62];
        $c = $xor63;
        var $xor76 = HEAP[(($c >>> 8 & 255) << 2) + _crc_table + 5120 | 0] ^ HEAP[(($c & 255) << 2) + _crc_table + 4096 | 0] ^ HEAP[(($c >>> 16 & 255) << 2) + _crc_table + 6144 | 0] ^ HEAP[($c >>> 24 << 2) + _crc_table + 7168 | 0];
        $c = $xor76;
        var $incdec_ptr77 = $buf4 + 4 | 0;
        $buf4 = $incdec_ptr77;
        var $xor78 = $c ^ HEAP[$incdec_ptr77];
        $c = $xor78;
        var $xor91 = HEAP[(($c >>> 8 & 255) << 2) + _crc_table + 5120 | 0] ^ HEAP[(($c & 255) << 2) + _crc_table + 4096 | 0] ^ HEAP[(($c >>> 16 & 255) << 2) + _crc_table + 6144 | 0] ^ HEAP[($c >>> 24 << 2) + _crc_table + 7168 | 0];
        $c = $xor91;
        var $incdec_ptr92 = $buf4 + 4 | 0;
        $buf4 = $incdec_ptr92;
        var $xor93 = $c ^ HEAP[$incdec_ptr92];
        $c = $xor93;
        var $xor106 = HEAP[(($c >>> 8 & 255) << 2) + _crc_table + 5120 | 0] ^ HEAP[(($c & 255) << 2) + _crc_table + 4096 | 0] ^ HEAP[(($c >>> 16 & 255) << 2) + _crc_table + 6144 | 0] ^ HEAP[($c >>> 24 << 2) + _crc_table + 7168 | 0];
        $c = $xor106;
        var $incdec_ptr107 = $buf4 + 4 | 0;
        $buf4 = $incdec_ptr107;
        var $xor108 = $c ^ HEAP[$incdec_ptr107];
        $c = $xor108;
        var $xor121 = HEAP[(($c >>> 8 & 255) << 2) + _crc_table + 5120 | 0] ^ HEAP[(($c & 255) << 2) + _crc_table + 4096 | 0] ^ HEAP[(($c >>> 16 & 255) << 2) + _crc_table + 6144 | 0] ^ HEAP[($c >>> 24 << 2) + _crc_table + 7168 | 0];
        $c = $xor121;
        var $incdec_ptr122 = $buf4 + 4 | 0;
        $buf4 = $incdec_ptr122;
        var $xor123 = $c ^ HEAP[$incdec_ptr122];
        $c = $xor123;
        var $xor136 = HEAP[(($c >>> 8 & 255) << 2) + _crc_table + 5120 | 0] ^ HEAP[(($c & 255) << 2) + _crc_table + 4096 | 0] ^ HEAP[(($c >>> 16 & 255) << 2) + _crc_table + 6144 | 0] ^ HEAP[($c >>> 24 << 2) + _crc_table + 7168 | 0];
        $c = $xor136;
        var $sub = $len_addr - 32 | 0;
        $len_addr = $sub;
        if (!($sub >>> 0 >= 32)) {
          var $_pr2 = $sub;
          break $while_body16$$while_cond138thread_pre_split$7;
        }
      }
    } else {
      var $_pr2 = $_pr1;
    }
  } while (0);
  var $_pr2;
  var $cmp1393 = $_pr2 >>> 0 >= 4;
  var $incdec_ptr1424 = $buf4 + 4 | 0;
  $buf4 = $incdec_ptr1424;
  $while_body141$$while_end158thread_pre_split$11 : do {
    if ($cmp1393) {
      var $incdec_ptr1425 = $incdec_ptr1424;
      while (1) {
        var $incdec_ptr1425;
        var $xor143 = $c ^ HEAP[$incdec_ptr1425];
        $c = $xor143;
        var $xor156 = HEAP[(($c >>> 8 & 255) << 2) + _crc_table + 5120 | 0] ^ HEAP[(($c & 255) << 2) + _crc_table + 4096 | 0] ^ HEAP[(($c >>> 16 & 255) << 2) + _crc_table + 6144 | 0] ^ HEAP[($c >>> 24 << 2) + _crc_table + 7168 | 0];
        $c = $xor156;
        var $sub157 = $len_addr - 4 | 0;
        $len_addr = $sub157;
        var $incdec_ptr142 = $buf4 + 4 | 0;
        $buf4 = $incdec_ptr142;
        if (!($sub157 >>> 0 >= 4)) {
          var $119 = $sub157;
          break $while_body141$$while_end158thread_pre_split$11;
        }
        var $incdec_ptr1425 = $incdec_ptr142;
      }
    } else {
      var $119 = $len_addr;
    }
  } while (0);
  var $119;
  $buf_addr = $buf4;
  var $tobool160 = ($119 | 0) != 0;
  $do_body$$if_end$16 : do {
    if ($tobool160) {
      while (1) {
        var $123 = $buf_addr;
        var $incdec_ptr162 = $123 + 1 | 0;
        $buf_addr = $incdec_ptr162;
        var $xor167 = $c << 8 ^ HEAP[((HEAP[$123] & 255 ^ $c >>> 24) << 2) + _crc_table + 4096 | 0];
        $c = $xor167;
        var $dec168 = $len_addr - 1 | 0;
        $len_addr = $dec168;
        if (($dec168 | 0) == 0) {
          break $do_body$$if_end$16;
        }
      }
    }
  } while (0);
  var $neg170 = $c ^ -1;
  $c = $neg170;
  return (($c & 65280) << 8) + (($c & 255) << 24) + ($c >>> 8 & 65280) + ($c >>> 24 & 255) | 0;
  return null;
}

_crc32_big["X"] = 1;

function _zcalloc($opaque, $items, $size) {
  var $opaque_addr;
  var $items_addr;
  var $size_addr;
  $opaque_addr = $opaque;
  $items_addr = $items;
  $size_addr = $size;
  if (($opaque_addr | 0) != 0) {
    var $add = -$size_addr + $size_addr + $items_addr | 0;
    $items_addr = $add;
  }
  var $call = _malloc($size_addr * $items_addr | 0);
  return $call;
  return null;
}

function _zcfree($opaque, $ptr) {
  var $opaque_addr;
  var $ptr_addr;
  $opaque_addr = $opaque;
  $ptr_addr = $ptr;
  _free($ptr_addr);
  return;
  return;
}

function _inflate_table($type, $lens, $codes, $table, $bits, $work) {
  var __stackBase__ = STACKTOP;
  STACKTOP += 68;
  var __label__;
  var $retval;
  var $type_addr;
  var $lens_addr;
  var $codes_addr;
  var $table_addr;
  var $bits_addr;
  var $work_addr;
  var $len;
  var $sym;
  var $min;
  var $max;
  var $root;
  var $curr;
  var $drop;
  var $left;
  var $used;
  var $huff;
  var $incr;
  var $fill;
  var $low;
  var $mask;
  var $here = __stackBase__;
  var $next;
  var $base;
  var $extra;
  var $end;
  var $count = __stackBase__ + 4;
  var $offs = __stackBase__ + 36;
  $type_addr = $type;
  $lens_addr = $lens;
  $codes_addr = $codes;
  $table_addr = $table;
  $bits_addr = $bits;
  $work_addr = $work;
  $len = 0;
  while (1) {
    HEAP[($len << 1) + $count | 0] = 0;
    var $inc = $len + 1 | 0;
    $len = $inc;
    if (!($inc >>> 0 <= 15)) {
      break;
    }
  }
  $sym = 0;
  var $cmp214 = $sym >>> 0 < $codes_addr >>> 0;
  $for_body3$$for_end9$5 : do {
    if ($cmp214) {
      while (1) {
        var $arrayidx5 = ((HEAP[($sym << 1) + $lens_addr | 0] & 65535) << 1) + $count | 0;
        var $inc6 = HEAP[$arrayidx5] + 1 & 65535;
        HEAP[$arrayidx5] = $inc6;
        var $inc8 = $sym + 1 | 0;
        $sym = $inc8;
        if ($sym >>> 0 >= $codes_addr >>> 0) {
          break $for_body3$$for_end9$5;
        }
      }
    }
  } while (0);
  $root = HEAP[$bits_addr];
  $max = 15;
  var $13 = 15;
  while (1) {
    var $13;
    if (!($13 >>> 0 >= 1)) {
      break;
    }
    if ((HEAP[($max << 1) + $count | 0] & 65535 | 0) != 0) {
      break;
    }
    var $dec = $max - 1 | 0;
    $max = $dec;
    var $13 = $dec;
  }
  var $18 = $max;
  if ($root >>> 0 > $18 >>> 0) {
    var $19 = $max;
    $root = $19;
    var $20 = $19;
  } else {
    var $20 = $18;
  }
  var $20;
  var $cmp22 = ($20 | 0) == 0;
  $if_then24$$if_end27$17 : do {
    if ($cmp22) {
      HEAP[$here | 0] = 64;
      HEAP[$here + 1 | 0] = 1;
      HEAP[$here + 2 | 0] = 0;
      var $21 = $table_addr;
      var $22 = HEAP[$21];
      var $incdec_ptr = $22 + 4 | 0;
      HEAP[$21] = $incdec_ptr;
      var $23 = $22;
      var $24 = $here;
      HEAP[$23] = HEAP[$24];
      HEAP[$23 + 1] = HEAP[$24 + 1];
      HEAP[$23 + 2] = HEAP[$24 + 2];
      HEAP[$23 + 3] = HEAP[$24 + 3];
      var $25 = $table_addr;
      var $26 = HEAP[$25];
      var $incdec_ptr26 = $26 + 4 | 0;
      HEAP[$25] = $incdec_ptr26;
      var $27 = $26;
      var $28 = $here;
      HEAP[$27] = HEAP[$28];
      HEAP[$27 + 1] = HEAP[$28 + 1];
      HEAP[$27 + 2] = HEAP[$28 + 2];
      HEAP[$27 + 3] = HEAP[$28 + 3];
      HEAP[$bits_addr] = 1;
      $retval = 0;
    } else {
      $min = 1;
      while (1) {
        if ($min >>> 0 >= $max >>> 0) {
          break;
        }
        if ((HEAP[($min << 1) + $count | 0] & 65535 | 0) != 0) {
          break;
        }
        var $inc39 = $min + 1 | 0;
        $min = $inc39;
      }
      if ($root >>> 0 < $min >>> 0) {
        $root = $min;
      }
      $left = 1;
      $len = 1;
      var $39 = 1;
      var $38 = 1;
      while (1) {
        var $38;
        var $39;
        if (!($39 >>> 0 <= 15)) {
          break;
        }
        $left = $38 << 1;
        var $sub = $left - (HEAP[($len << 1) + $count | 0] & 65535) | 0;
        $left = $sub;
        if (($left | 0) < 0) {
          $retval = -1;
          break $if_then24$$if_end27$17;
        }
        var $inc56 = $len + 1 | 0;
        $len = $inc56;
        var $39 = $inc56;
        var $38 = $left;
      }
      var $cmp58 = ($38 | 0) > 0;
      do {
        if ($cmp58) {
          if (($type_addr | 0) != 0) {
            if (($max | 0) == 1) {
              break;
            }
          }
          $retval = -1;
          break $if_then24$$if_end27$17;
        }
      } while (0);
      HEAP[$offs + 2 | 0] = 0;
      $len = 1;
      while (1) {
        var $conv75 = (HEAP[($len << 1) + $count | 0] & 65535) + (HEAP[($len << 1) + $offs | 0] & 65535) & 65535;
        HEAP[($len + 1 << 1) + $offs | 0] = $conv75;
        var $inc79 = $len + 1 | 0;
        $len = $inc79;
        if ($inc79 >>> 0 >= 15) {
          break;
        }
      }
      $sym = 0;
      var $cmp8211 = $sym >>> 0 < $codes_addr >>> 0;
      $for_body84$$for_end100$44 : do {
        if ($cmp8211) {
          while (1) {
            if ((HEAP[($sym << 1) + $lens_addr | 0] & 65535 | 0) != 0) {
              var $arrayidx93 = ((HEAP[($sym << 1) + $lens_addr | 0] & 65535) << 1) + $offs | 0;
              var $62 = HEAP[$arrayidx93];
              var $inc94 = $62 + 1 & 65535;
              HEAP[$arrayidx93] = $inc94;
              var $arrayidx96 = (($62 & 65535) << 1) + $work_addr | 0;
              HEAP[$arrayidx96] = $sym & 65535;
            }
            var $inc99 = $sym + 1 | 0;
            $sym = $inc99;
            if ($sym >>> 0 >= $codes_addr >>> 0) {
              break $for_body84$$for_end100$44;
            }
          }
        }
      } while (0);
      var $67 = $type_addr;
      if ($67 == 0) {
        var $68 = $work_addr;
        $extra = $68;
        $base = $68;
        $end = 19;
      } else if ($67 == 1) {
        $base = _inflate_table_lbase | 0;
        var $add_ptr = $base - 514 | 0;
        $base = $add_ptr;
        $extra = _inflate_table_lext | 0;
        var $add_ptr102 = $extra - 514 | 0;
        $extra = $add_ptr102;
        $end = 256;
      } else {
        $base = _inflate_table_dbase | 0;
        $extra = _inflate_table_dext | 0;
        $end = -1;
      }
      $huff = 0;
      $sym = 0;
      $len = $min;
      $next = HEAP[$table_addr];
      $curr = $root;
      $drop = 0;
      $low = -1;
      $used = 1 << $root;
      $mask = $used - 1 | 0;
      var $77 = $type_addr;
      var $cmp105 = ($77 | 0) == 1;
      do {
        if ($cmp105) {
          if ($used >>> 0 >= 852) {
            __label__ = 43;
            break;
          }
          var $79 = $type_addr;
          __label__ = 40;
          break;
        }
        var $79 = $77;
        __label__ = 40;
      } while (0);
      do {
        if (__label__ == 40) {
          var $79;
          if (($79 | 0) == 2) {
            if ($used >>> 0 >= 592) {
              break;
            }
          }
          var $bits121 = $here + 1 | 0;
          var $op127 = $here | 0;
          var $val129 = $here + 2 | 0;
          var $80 = $here;
          var $op139 = $here | 0;
          var $val143 = $here + 2 | 0;
          var $op145 = $here | 0;
          var $val146 = $here + 2 | 0;
          $for_cond118$64 : while (1) {
            HEAP[$bits121] = $len - $drop & 255;
            if ((HEAP[($sym << 1) + $work_addr | 0] & 65535 | 0) < ($end | 0)) {
              HEAP[$op127] = 0;
              var $90 = HEAP[($sym << 1) + $work_addr | 0];
              HEAP[$val129] = $90;
            } else {
              if ((HEAP[($sym << 1) + $work_addr | 0] & 65535 | 0) > ($end | 0)) {
                var $conv138 = HEAP[((HEAP[($sym << 1) + $work_addr | 0] & 65535) << 1) + $extra | 0] & 255;
                HEAP[$op139] = $conv138;
                var $104 = HEAP[((HEAP[($sym << 1) + $work_addr | 0] & 65535) << 1) + $base | 0];
                HEAP[$val143] = $104;
              } else {
                HEAP[$op145] = 96;
                HEAP[$val146] = 0;
              }
            }
            $incr = 1 << $len - $drop;
            $fill = 1 << $curr;
            $min = $fill;
            while (1) {
              var $sub152 = $fill - $incr | 0;
              $fill = $sub152;
              var $115 = (($huff >>> ($drop >>> 0)) + $fill << 2) + $next | 0;
              HEAP[$115] = HEAP[$80];
              HEAP[$115 + 1] = HEAP[$80 + 1];
              HEAP[$115 + 2] = HEAP[$80 + 2];
              HEAP[$115 + 3] = HEAP[$80 + 3];
              if (($fill | 0) == 0) {
                break;
              }
            }
            var $shl158 = 1 << $len - 1;
            $incr = $shl158;
            var $tobool9 = ($huff & $shl158 | 0) != 0;
            do {
              if ($tobool9) {
                var $119 = $shl158;
                while (1) {
                  var $119;
                  var $shr159 = $119 >>> 1;
                  $incr = $shr159;
                  if (($huff & $shr159 | 0) == 0) {
                    break;
                  }
                  var $119 = $shr159;
                }
                if (($shr159 | 0) != 0) {
                  __label__ = 54;
                  break;
                }
                $huff = 0;
                __label__ = 56;
                break;
              }
              __label__ = 54;
            } while (0);
            if (__label__ == 54) {
              var $and164 = $huff & $incr - 1;
              $huff = $and164;
              var $add165 = $huff + $incr | 0;
              $huff = $add165;
            }
            var $inc168 = $sym + 1 | 0;
            $sym = $inc168;
            var $arrayidx169 = ($len << 1) + $count | 0;
            var $dec170 = HEAP[$arrayidx169] - 1 & 65535;
            HEAP[$arrayidx169] = $dec170;
            if (($dec170 & 65535 | 0) == 0) {
              if (($len | 0) == ($max | 0)) {
                break;
              }
              $len = HEAP[((HEAP[($sym << 1) + $work_addr | 0] & 65535) << 1) + $lens_addr | 0] & 65535;
            }
            if ($len >>> 0 <= $root >>> 0) {
              continue;
            }
            if (($mask & $huff | 0) == ($low | 0)) {
              continue;
            }
            if (($drop | 0) == 0) {
              $drop = $root;
            }
            var $add_ptr195 = ($min << 2) + $next | 0;
            $next = $add_ptr195;
            $curr = $len - $drop | 0;
            $left = 1 << $curr;
            while (1) {
              if (($drop + $curr | 0) >>> 0 >= $max >>> 0) {
                break;
              }
              var $sub206 = $left - (HEAP[($drop + $curr << 1) + $count | 0] & 65535) | 0;
              $left = $sub206;
              if (($left | 0) <= 0) {
                break;
              }
              var $inc211 = $curr + 1 | 0;
              $curr = $inc211;
              var $shl212 = $left << 1;
              $left = $shl212;
            }
            var $add215 = (1 << $curr) + $used | 0;
            $used = $add215;
            var $159 = $type_addr;
            var $cmp216 = ($159 | 0) == 1;
            do {
              if ($cmp216) {
                if ($used >>> 0 >= 852) {
                  __label__ = 72;
                  break;
                }
                var $161 = $type_addr;
                __label__ = 70;
                break;
              }
              var $161 = $159;
              __label__ = 70;
            } while (0);
            do {
              if (__label__ == 70) {
                var $161;
                if (($161 | 0) == 2) {
                  if ($used >>> 0 >= 592) {
                    break;
                  }
                }
                $low = $mask & $huff;
                var $op232 = ($low << 2) + HEAP[$table_addr] | 0;
                HEAP[$op232] = $curr & 255;
                var $bits235 = ($low << 2) + HEAP[$table_addr] + 1 | 0;
                HEAP[$bits235] = $root & 255;
                var $conv236 = ($next - HEAP[$table_addr]) / 4 & 65535;
                var $val238 = ($low << 2) + HEAP[$table_addr] + 2 | 0;
                HEAP[$val238] = $conv236;
                continue $for_cond118$64;
              }
            } while (0);
            $retval = 1;
            break $if_then24$$if_end27$17;
          }
          HEAP[$here | 0] = 64;
          HEAP[$here + 1 | 0] = $len - $drop & 255;
          HEAP[$here + 2 | 0] = 0;
          var $cmp2476 = ($huff | 0) != 0;
          $while_body249_lr_ph$$while_end278$108 : do {
            if ($cmp2476) {
              var $bits258 = $here + 1 | 0;
              var $181 = $here;
              while (1) {
                var $cmp250 = ($drop | 0) != 0;
                do {
                  if ($cmp250) {
                    if (($mask & $huff | 0) == ($low | 0)) {
                      break;
                    }
                    $drop = 0;
                    $len = $root;
                    $next = HEAP[$table_addr];
                    HEAP[$bits258] = $len & 255;
                  }
                } while (0);
                var $193 = ($huff >>> ($drop >>> 0) << 2) + $next | 0;
                HEAP[$193] = HEAP[$181];
                HEAP[$193 + 1] = HEAP[$181 + 1];
                HEAP[$193 + 2] = HEAP[$181 + 2];
                HEAP[$193 + 3] = HEAP[$181 + 3];
                var $shl263 = 1 << $len - 1;
                $incr = $shl263;
                if (($huff & $shl263 | 0) != 0) {
                  var $196 = $shl263;
                  while (1) {
                    var $196;
                    var $shr268 = $196 >>> 1;
                    $incr = $shr268;
                    if (($huff & $shr268 | 0) == 0) {
                      break;
                    }
                    var $196 = $shr268;
                  }
                  if (($shr268 | 0) == 0) {
                    break;
                  }
                }
                var $and274 = $huff & $incr - 1;
                $huff = $and274;
                var $add275 = $huff + $incr | 0;
                $huff = $add275;
                if (($add275 | 0) == 0) {
                  break $while_body249_lr_ph$$while_end278$108;
                }
              }
              $huff = 0;
            }
          } while (0);
          var $203 = $table_addr;
          var $add_ptr279 = ($used << 2) + HEAP[$203] | 0;
          HEAP[$203] = $add_ptr279;
          HEAP[$bits_addr] = $root;
          $retval = 0;
          break $if_then24$$if_end27$17;
        }
      } while (0);
      $retval = 1;
    }
  } while (0);
  STACKTOP = __stackBase__;
  return $retval;
  return null;
}

_inflate_table["X"] = 1;

function _inflate_fast($strm, $start) {
  var __stackBase__ = STACKTOP;
  STACKTOP += 4;
  var __label__;
  var $strm_addr;
  var $start_addr;
  var $state;
  var $in;
  var $last;
  var $out;
  var $beg;
  var $end;
  var $wsize;
  var $whave;
  var $wnext;
  var $window;
  var $hold;
  var $bits;
  var $lcode;
  var $dcode;
  var $lmask;
  var $dmask;
  var $here = __stackBase__;
  var $op;
  var $len;
  var $dist;
  var $from;
  $strm_addr = $strm;
  $start_addr = $start;
  $state = HEAP[$strm_addr + 28 | 0];
  $in = HEAP[$strm_addr | 0] - 1 | 0;
  $last = $in + (HEAP[$strm_addr + 4 | 0] - 5) | 0;
  $out = HEAP[$strm_addr + 12 | 0] - 1 | 0;
  $beg = $out + -($start_addr + -HEAP[$strm_addr + 16 | 0]) | 0;
  $end = $out + (HEAP[$strm_addr + 16 | 0] - 257) | 0;
  $wsize = HEAP[$state + 40 | 0];
  $whave = HEAP[$state + 44 | 0];
  $wnext = HEAP[$state + 48 | 0];
  $window = HEAP[$state + 52 | 0];
  $hold = HEAP[$state + 56 | 0];
  $bits = HEAP[$state + 60 | 0];
  $lcode = HEAP[$state + 76 | 0];
  $dcode = HEAP[$state + 80 | 0];
  $lmask = (1 << HEAP[$state + 84 | 0]) - 1 | 0;
  $dmask = (1 << HEAP[$state + 88 | 0]) - 1 | 0;
  var $37 = $here;
  var $bits25 = $here + 1 | 0;
  var $op28 = $here | 0;
  var $val260 = $here + 2 | 0;
  var $38 = $here;
  var $val = $here + 2 | 0;
  var $val37 = $here + 2 | 0;
  var $39 = $here;
  var $bits74 = $here + 1 | 0;
  var $op78 = $here | 0;
  var $val244 = $here + 2 | 0;
  var $40 = $here;
  var $val83 = $here + 2 | 0;
  $do_body$2 : while (1) {
    if ($bits >>> 0 < 15) {
      var $incdec_ptr = $in + 1 | 0;
      $in = $incdec_ptr;
      var $add = ((HEAP[$incdec_ptr] & 255) << $bits) + $hold | 0;
      $hold = $add;
      var $add19 = $bits + 8 | 0;
      $bits = $add19;
      var $incdec_ptr20 = $in + 1 | 0;
      $in = $incdec_ptr20;
      var $add23 = ((HEAP[$incdec_ptr20] & 255) << $bits) + $hold | 0;
      $hold = $add23;
      var $add24 = $bits + 8 | 0;
      $bits = $add24;
    }
    var $55 = (($lmask & $hold) << 2) + $lcode | 0;
    HEAP[$37] = HEAP[$55];
    HEAP[$37 + 1] = HEAP[$55 + 1];
    HEAP[$37 + 2] = HEAP[$55 + 2];
    HEAP[$37 + 3] = HEAP[$55 + 3];
    while (1) {
      $op = HEAP[$bits25] & 255;
      var $shr = $hold >>> ($op >>> 0);
      $hold = $shr;
      var $sub27 = $bits - $op | 0;
      $bits = $sub27;
      var $conv29 = HEAP[$op28] & 255;
      $op = $conv29;
      if (($conv29 | 0) == 0) {
        var $conv33 = HEAP[$val] & 255;
        var $incdec_ptr34 = $out + 1 | 0;
        $out = $incdec_ptr34;
        HEAP[$incdec_ptr34] = $conv33;
        __label__ = 59;
        break;
      }
      if (($op & 16 | 0) != 0) {
        __label__ = 7;
        break;
      }
      if (($op & 64 | 0) == 0) {
        var $246 = (((1 << $op) - 1 & $hold) + (HEAP[$val260] & 65535) << 2) + $lcode | 0;
        HEAP[$38] = HEAP[$246];
        HEAP[$38 + 1] = HEAP[$246 + 1];
        HEAP[$38 + 2] = HEAP[$246 + 2];
        HEAP[$38 + 3] = HEAP[$246 + 3];
      } else {
        if (($op & 32 | 0) != 0) {
          HEAP[$state | 0] = 11;
          break $do_body$2;
        }
        HEAP[$strm_addr + 24 | 0] = STRING_TABLE.__str271 | 0;
        HEAP[$state | 0] = 29;
        break $do_body$2;
      }
    }
    do {
      if (__label__ == 7) {
        $len = HEAP[$val37] & 65535;
        var $and39 = $op & 15;
        $op = $and39;
        var $68 = $bits;
        if (($op | 0) != 0) {
          if ($68 >>> 0 < $op >>> 0) {
            var $incdec_ptr45 = $in + 1 | 0;
            $in = $incdec_ptr45;
            var $add48 = ((HEAP[$incdec_ptr45] & 255) << $bits) + $hold | 0;
            $hold = $add48;
            var $add49 = $bits + 8 | 0;
            $bits = $add49;
          }
          var $add54 = ((1 << $op) - 1 & $hold) + $len | 0;
          $len = $add54;
          var $shr55 = $hold >>> ($op >>> 0);
          $hold = $shr55;
          var $sub56 = $bits - $op | 0;
          $bits = $sub56;
          var $82 = $sub56;
        } else {
          var $82 = $68;
        }
        var $82;
        if ($82 >>> 0 < 15) {
          var $incdec_ptr61 = $in + 1 | 0;
          $in = $incdec_ptr61;
          var $add64 = ((HEAP[$incdec_ptr61] & 255) << $bits) + $hold | 0;
          $hold = $add64;
          var $add65 = $bits + 8 | 0;
          $bits = $add65;
          var $incdec_ptr66 = $in + 1 | 0;
          $in = $incdec_ptr66;
          var $add69 = ((HEAP[$incdec_ptr66] & 255) << $bits) + $hold | 0;
          $hold = $add69;
          var $add70 = $bits + 8 | 0;
          $bits = $add70;
        }
        var $96 = (($dmask & $hold) << 2) + $dcode | 0;
        HEAP[$39] = HEAP[$96];
        HEAP[$39 + 1] = HEAP[$96 + 1];
        HEAP[$39 + 2] = HEAP[$96 + 2];
        HEAP[$39 + 3] = HEAP[$96 + 3];
        while (1) {
          $op = HEAP[$bits74] & 255;
          var $shr76 = $hold >>> ($op >>> 0);
          $hold = $shr76;
          var $sub77 = $bits - $op | 0;
          $bits = $sub77;
          $op = HEAP[$op78] & 255;
          if (($op & 16 | 0) != 0) {
            break;
          }
          if (($op & 64 | 0) != 0) {
            HEAP[$strm_addr + 24 | 0] = STRING_TABLE.__str170 | 0;
            HEAP[$state | 0] = 29;
            break $do_body$2;
          }
          var $238 = (((1 << $op) - 1 & $hold) + (HEAP[$val244] & 65535) << 2) + $dcode | 0;
          HEAP[$40] = HEAP[$238];
          HEAP[$40 + 1] = HEAP[$238 + 1];
          HEAP[$40 + 2] = HEAP[$238 + 2];
          HEAP[$40 + 3] = HEAP[$238 + 3];
        }
        $dist = HEAP[$val83] & 65535;
        var $and85 = $op & 15;
        $op = $and85;
        var $cmp86 = $bits >>> 0 < $op >>> 0;
        do {
          if ($cmp86) {
            var $incdec_ptr89 = $in + 1 | 0;
            $in = $incdec_ptr89;
            var $add92 = ((HEAP[$incdec_ptr89] & 255) << $bits) + $hold | 0;
            $hold = $add92;
            var $add93 = $bits + 8 | 0;
            $bits = $add93;
            if ($bits >>> 0 >= $op >>> 0) {
              break;
            }
            var $incdec_ptr97 = $in + 1 | 0;
            $in = $incdec_ptr97;
            var $add100 = ((HEAP[$incdec_ptr97] & 255) << $bits) + $hold | 0;
            $hold = $add100;
            var $add101 = $bits + 8 | 0;
            $bits = $add101;
          }
        } while (0);
        var $add107 = ((1 << $op) - 1 & $hold) + $dist | 0;
        $dist = $add107;
        var $shr108 = $hold >>> ($op >>> 0);
        $hold = $shr108;
        var $sub109 = $bits - $op | 0;
        $bits = $sub109;
        $op = $out - $beg | 0;
        if ($dist >>> 0 > $op >>> 0) {
          var $sub113 = $dist - $op | 0;
          $op = $sub113;
          var $cmp114 = $op >>> 0 > $whave >>> 0;
          do {
            if ($cmp114) {
              if ((HEAP[$state + 7104 | 0] | 0) == 0) {
                break;
              }
              HEAP[$strm_addr + 24 | 0] = STRING_TABLE.__str69 | 0;
              HEAP[$state | 0] = 29;
              break $do_body$2;
            }
          } while (0);
          $from = $window - 1 | 0;
          var $cmp122 = ($wnext | 0) == 0;
          do {
            if ($cmp122) {
              var $add_ptr126 = $from + ($wsize - $op) | 0;
              $from = $add_ptr126;
              var $145 = $len;
              if ($op >>> 0 >= $145 >>> 0) {
                var $_ph = $145;
                __label__ = 40;
                break;
              }
              var $sub130 = $len - $op | 0;
              $len = $sub130;
              while (1) {
                var $incdec_ptr132 = $from + 1 | 0;
                $from = $incdec_ptr132;
                var $149 = HEAP[$incdec_ptr132];
                var $incdec_ptr133 = $out + 1 | 0;
                $out = $incdec_ptr133;
                HEAP[$incdec_ptr133] = $149;
                var $dec = $op - 1 | 0;
                $op = $dec;
                if (($dec | 0) == 0) {
                  break;
                }
              }
              $from = $out + -$dist | 0;
              __label__ = 39;
              break;
            }
            if ($wnext >>> 0 < $op >>> 0) {
              var $add_ptr144 = $from + $wnext + $wsize + -$op | 0;
              $from = $add_ptr144;
              var $sub145 = $op - $wnext | 0;
              $op = $sub145;
              var $163 = $len;
              if ($op >>> 0 >= $163 >>> 0) {
                var $_ph = $163;
                __label__ = 40;
                break;
              }
              var $sub149 = $len - $op | 0;
              $len = $sub149;
              while (1) {
                var $incdec_ptr151 = $from + 1 | 0;
                $from = $incdec_ptr151;
                var $167 = HEAP[$incdec_ptr151];
                var $incdec_ptr152 = $out + 1 | 0;
                $out = $incdec_ptr152;
                HEAP[$incdec_ptr152] = $167;
                var $dec154 = $op - 1 | 0;
                $op = $dec154;
                if (($dec154 | 0) == 0) {
                  break;
                }
              }
              $from = $window - 1 | 0;
              var $172 = $len;
              if ($wnext >>> 0 >= $172 >>> 0) {
                var $_ph = $172;
                __label__ = 40;
                break;
              }
              $op = $wnext;
              var $sub161 = $len - $op | 0;
              $len = $sub161;
              while (1) {
                var $incdec_ptr163 = $from + 1 | 0;
                $from = $incdec_ptr163;
                var $177 = HEAP[$incdec_ptr163];
                var $incdec_ptr164 = $out + 1 | 0;
                $out = $incdec_ptr164;
                HEAP[$incdec_ptr164] = $177;
                var $dec166 = $op - 1 | 0;
                $op = $dec166;
                if (($dec166 | 0) == 0) {
                  break;
                }
              }
              $from = $out + -$dist | 0;
              __label__ = 39;
              break;
            }
            var $add_ptr175 = $from + ($wnext - $op) | 0;
            $from = $add_ptr175;
            var $186 = $len;
            if ($op >>> 0 >= $186 >>> 0) {
              var $_ph = $186;
              __label__ = 40;
              break;
            }
            var $sub179 = $len - $op | 0;
            $len = $sub179;
            while (1) {
              var $incdec_ptr181 = $from + 1 | 0;
              $from = $incdec_ptr181;
              var $190 = HEAP[$incdec_ptr181];
              var $incdec_ptr182 = $out + 1 | 0;
              $out = $incdec_ptr182;
              HEAP[$incdec_ptr182] = $190;
              var $dec184 = $op - 1 | 0;
              $op = $dec184;
              if (($dec184 | 0) == 0) {
                break;
              }
            }
            $from = $out + -$dist | 0;
            __label__ = 39;
            break;
          } while (0);
          if (__label__ == 39) {
            var $_ph = $len;
          }
          var $_ph;
          var $cmp1923 = $_ph >>> 0 > 2;
          $while_body$$while_endthread_pre_split$72 : do {
            if ($cmp1923) {
              while (1) {
                var $incdec_ptr194 = $from + 1 | 0;
                $from = $incdec_ptr194;
                var $196 = HEAP[$incdec_ptr194];
                var $incdec_ptr195 = $out + 1 | 0;
                $out = $incdec_ptr195;
                HEAP[$incdec_ptr195] = $196;
                var $incdec_ptr196 = $from + 1 | 0;
                $from = $incdec_ptr196;
                var $199 = HEAP[$incdec_ptr196];
                var $incdec_ptr197 = $out + 1 | 0;
                $out = $incdec_ptr197;
                HEAP[$incdec_ptr197] = $199;
                var $incdec_ptr198 = $from + 1 | 0;
                $from = $incdec_ptr198;
                var $202 = HEAP[$incdec_ptr198];
                var $incdec_ptr199 = $out + 1 | 0;
                $out = $incdec_ptr199;
                HEAP[$incdec_ptr199] = $202;
                var $sub200 = $len - 3 | 0;
                $len = $sub200;
                if ($sub200 >>> 0 <= 2) {
                  var $205 = $sub200;
                  break $while_body$$while_endthread_pre_split$72;
                }
              }
            } else {
              var $205 = $len;
            }
          } while (0);
          var $205;
          if (($205 | 0) == 0) {
            break;
          }
          var $incdec_ptr203 = $from + 1 | 0;
          $from = $incdec_ptr203;
          var $207 = HEAP[$incdec_ptr203];
          var $incdec_ptr204 = $out + 1 | 0;
          $out = $incdec_ptr204;
          HEAP[$incdec_ptr204] = $207;
          if ($len >>> 0 <= 1) {
            break;
          }
          var $incdec_ptr208 = $from + 1 | 0;
          $from = $incdec_ptr208;
          var $211 = HEAP[$incdec_ptr208];
          var $incdec_ptr209 = $out + 1 | 0;
          $out = $incdec_ptr209;
          HEAP[$incdec_ptr209] = $211;
        } else {
          $from = $out + -$dist | 0;
          while (1) {
            var $incdec_ptr216 = $from + 1 | 0;
            $from = $incdec_ptr216;
            var $216 = HEAP[$incdec_ptr216];
            var $incdec_ptr217 = $out + 1 | 0;
            $out = $incdec_ptr217;
            HEAP[$incdec_ptr217] = $216;
            var $incdec_ptr218 = $from + 1 | 0;
            $from = $incdec_ptr218;
            var $219 = HEAP[$incdec_ptr218];
            var $incdec_ptr219 = $out + 1 | 0;
            $out = $incdec_ptr219;
            HEAP[$incdec_ptr219] = $219;
            var $incdec_ptr220 = $from + 1 | 0;
            $from = $incdec_ptr220;
            var $222 = HEAP[$incdec_ptr220];
            var $incdec_ptr221 = $out + 1 | 0;
            $out = $incdec_ptr221;
            HEAP[$incdec_ptr221] = $222;
            var $sub222 = $len - 3 | 0;
            $len = $sub222;
            if ($sub222 >>> 0 <= 2) {
              break;
            }
          }
          if (($len | 0) == 0) {
            break;
          }
          var $incdec_ptr229 = $from + 1 | 0;
          $from = $incdec_ptr229;
          var $227 = HEAP[$incdec_ptr229];
          var $incdec_ptr230 = $out + 1 | 0;
          $out = $incdec_ptr230;
          HEAP[$incdec_ptr230] = $227;
          if ($len >>> 0 <= 1) {
            break;
          }
          var $incdec_ptr234 = $from + 1 | 0;
          $from = $incdec_ptr234;
          var $231 = HEAP[$incdec_ptr234];
          var $incdec_ptr235 = $out + 1 | 0;
          $out = $incdec_ptr235;
          HEAP[$incdec_ptr235] = $231;
        }
      }
    } while (0);
    if ($in >>> 0 >= $last >>> 0) {
      break;
    }
    if ($out >>> 0 >= $end >>> 0) {
      break;
    }
  }
  $len = $bits >>> 3;
  var $add_ptr285 = $in + -$len | 0;
  $in = $add_ptr285;
  var $sub287 = $bits - ($len << 3) | 0;
  $bits = $sub287;
  var $and290 = (1 << $bits) - 1 & $hold;
  $hold = $and290;
  HEAP[$strm_addr | 0] = $in + 1 | 0;
  HEAP[$strm_addr + 12 | 0] = $out + 1 | 0;
  if ($in >>> 0 < $last >>> 0) {
    var $cond = $last + -$in + 5 | 0;
  } else {
    var $cond = -$in + -(-$last) + 5 | 0;
  }
  var $cond;
  HEAP[$strm_addr + 4 | 0] = $cond;
  if ($out >>> 0 < $end >>> 0) {
    var $cond319 = $end + -$out + 257 | 0;
  } else {
    var $cond319 = -$out + -(-$end) + 257 | 0;
  }
  var $cond319;
  HEAP[$strm_addr + 16 | 0] = $cond319;
  HEAP[$state + 56 | 0] = $hold;
  HEAP[$state + 60 | 0] = $bits;
  STACKTOP = __stackBase__;
  return;
  return;
}

_inflate_fast["X"] = 1;

function _malloc($bytes) {
  var __label__;
  var $bytes_addr;
  var $mem;
  var $nb;
  var $idx;
  var $smallbits;
  var $b;
  var $p;
  var $F;
  var $b33;
  var $p34;
  var $r;
  var $rsize;
  var $i;
  var $leftbits;
  var $leastbit;
  var $Y;
  var $K;
  var $N;
  var $F68;
  var $DVS;
  var $DV;
  var $I;
  var $B;
  var $F102;
  var $rsize157;
  var $p159;
  var $r163;
  var $dvs;
  var $rsize185;
  var $p187;
  var $r188;
  $bytes_addr = $bytes;
  var $cmp = $bytes_addr >>> 0 <= 244;
  var $1 = $bytes_addr;
  do {
    if ($cmp) {
      if ($1 >>> 0 < 11) {
        var $cond = 16;
      } else {
        var $cond = $bytes_addr + 11 & -8;
      }
      var $cond;
      $nb = $cond;
      $idx = $nb >>> 3;
      $smallbits = HEAP[__gm_ | 0] >>> ($idx >>> 0);
      if (($smallbits & 3 | 0) != 0) {
        var $add8 = $idx + (($smallbits ^ -1) & 1) | 0;
        $idx = $add8;
        $b = ($idx << 3) + __gm_ + 40 | 0;
        $p = HEAP[$b + 8 | 0];
        $F = HEAP[$p + 8 | 0];
        if (($b | 0) == ($F | 0)) {
          var $and14 = HEAP[__gm_ | 0] & (1 << $idx ^ -1);
          HEAP[__gm_ | 0] = $and14;
        } else {
          if ((($F >>> 0 >= HEAP[__gm_ + 16 | 0] >>> 0 & 1) == 1 | 0) != 0) {
            HEAP[$b + 8 | 0] = $F;
            HEAP[$F + 12 | 0] = $b;
          } else {
            _abort();
            throw "Reached an unreachable!";
          }
        }
        HEAP[$p + 4 | 0] = $idx << 3 | 3;
        var $head23 = ($idx << 3) + $p + 4 | 0;
        var $or24 = HEAP[$head23] | 1;
        HEAP[$head23] = $or24;
        $mem = $p + 8 | 0;
        __label__ = 39;
        break;
      }
      if ($nb >>> 0 <= HEAP[__gm_ + 8 | 0] >>> 0) {
        __label__ = 31;
        break;
      }
      if (($smallbits | 0) != 0) {
        $leftbits = (-(1 << $idx << 1) | 1 << $idx << 1) & $smallbits << $idx;
        $leastbit = -$leftbits & $leftbits;
        $Y = $leastbit - 1 | 0;
        $K = $Y >>> 12 & 16;
        $N = $K;
        var $shr47 = $Y >>> ($K >>> 0);
        $Y = $shr47;
        var $and49 = $Y >>> 5 & 8;
        $K = $and49;
        var $add50 = $and49 + $N | 0;
        $N = $add50;
        var $shr51 = $Y >>> ($K >>> 0);
        $Y = $shr51;
        var $and53 = $Y >>> 2 & 4;
        $K = $and53;
        var $add54 = $and53 + $N | 0;
        $N = $add54;
        var $shr55 = $Y >>> ($K >>> 0);
        $Y = $shr55;
        var $and57 = $Y >>> 1 & 2;
        $K = $and57;
        var $add58 = $and57 + $N | 0;
        $N = $add58;
        var $shr59 = $Y >>> ($K >>> 0);
        $Y = $shr59;
        var $and61 = $Y >>> 1 & 1;
        $K = $and61;
        var $add62 = $and61 + $N | 0;
        $N = $add62;
        var $shr63 = $Y >>> ($K >>> 0);
        $Y = $shr63;
        $i = $Y + $N | 0;
        $b33 = ($i << 3) + __gm_ + 40 | 0;
        $p34 = HEAP[$b33 + 8 | 0];
        $F68 = HEAP[$p34 + 8 | 0];
        if (($b33 | 0) == ($F68 | 0)) {
          var $and75 = HEAP[__gm_ | 0] & (1 << $i ^ -1);
          HEAP[__gm_ | 0] = $and75;
        } else {
          if ((($F68 >>> 0 >= HEAP[__gm_ + 16 | 0] >>> 0 & 1) == 1 | 0) != 0) {
            HEAP[$b33 + 8 | 0] = $F68;
            HEAP[$F68 + 12 | 0] = $b33;
          } else {
            _abort();
            throw "Reached an unreachable!";
          }
        }
        $rsize = ($i << 3) - $nb | 0;
        HEAP[$p34 + 4 | 0] = $nb | 3;
        $r = $p34 + $nb | 0;
        HEAP[$r + 4 | 0] = $rsize | 1;
        HEAP[$r + $rsize | 0] = $rsize;
        var $101 = HEAP[__gm_ + 8 | 0];
        $DVS = $101;
        if (($101 | 0) != 0) {
          $DV = HEAP[__gm_ + 20 | 0];
          $I = $DVS >>> 3;
          $B = ($I << 3) + __gm_ + 40 | 0;
          $F102 = $B;
          if ((1 << $I & HEAP[__gm_ | 0] | 0) != 0) {
            if (((HEAP[$B + 8 | 0] >>> 0 >= HEAP[__gm_ + 16 | 0] >>> 0 & 1) == 1 | 0) != 0) {
              $F102 = HEAP[$B + 8 | 0];
            } else {
              _abort();
              throw "Reached an unreachable!";
            }
          } else {
            var $or108 = HEAP[__gm_ | 0] | 1 << $I;
            HEAP[__gm_ | 0] = $or108;
          }
          HEAP[$B + 8 | 0] = $DV;
          HEAP[$F102 + 12 | 0] = $DV;
          HEAP[$DV + 8 | 0] = $F102;
          HEAP[$DV + 12 | 0] = $B;
        }
        HEAP[__gm_ + 8 | 0] = $rsize;
        HEAP[__gm_ + 20 | 0] = $r;
        $mem = $p34 + 8 | 0;
        __label__ = 39;
        break;
      }
      if ((HEAP[__gm_ + 4 | 0] | 0) == 0) {
        __label__ = 31;
        break;
      }
      var $call = _tmalloc_small($nb);
      $mem = $call;
      if (($call | 0) != 0) {
        __label__ = 39;
        break;
      }
      __label__ = 31;
      break;
    } else {
      if ($1 >>> 0 >= 4294967232) {
        $nb = -1;
        __label__ = 31;
        break;
      }
      $nb = $bytes_addr + 11 & -8;
      if ((HEAP[__gm_ + 4 | 0] | 0) == 0) {
        __label__ = 31;
        break;
      }
      var $call147 = _tmalloc_large($nb);
      $mem = $call147;
      if (($call147 | 0) != 0) {
        __label__ = 39;
        break;
      }
      __label__ = 31;
      break;
    }
  } while (0);
  if (__label__ == 31) {
    if ($nb >>> 0 <= HEAP[__gm_ + 8 | 0] >>> 0) {
      $rsize157 = HEAP[__gm_ + 8 | 0] - $nb | 0;
      $p159 = HEAP[__gm_ + 20 | 0];
      if ($rsize157 >>> 0 >= 16) {
        var $144 = $p159 + $nb | 0;
        HEAP[__gm_ + 20 | 0] = $144;
        $r163 = $144;
        HEAP[__gm_ + 8 | 0] = $rsize157;
        HEAP[$r163 + 4 | 0] = $rsize157 | 1;
        HEAP[$r163 + $rsize157 | 0] = $rsize157;
        HEAP[$p159 + 4 | 0] = $nb | 3;
      } else {
        $dvs = HEAP[__gm_ + 8 | 0];
        HEAP[__gm_ + 8 | 0] = 0;
        HEAP[__gm_ + 20 | 0] = 0;
        HEAP[$p159 + 4 | 0] = $dvs | 3;
        var $head177 = $dvs + ($p159 + 4) | 0;
        var $or178 = HEAP[$head177] | 1;
        HEAP[$head177] = $or178;
      }
      $mem = $p159 + 8 | 0;
    } else {
      var $167 = $nb;
      if ($nb >>> 0 < HEAP[__gm_ + 12 | 0] >>> 0) {
        var $sub186 = HEAP[__gm_ + 12 | 0] - $167 | 0;
        HEAP[__gm_ + 12 | 0] = $sub186;
        $rsize185 = $sub186;
        $p187 = HEAP[__gm_ + 24 | 0];
        var $173 = $p187 + $nb | 0;
        HEAP[__gm_ + 24 | 0] = $173;
        $r188 = $173;
        HEAP[$r188 + 4 | 0] = $rsize185 | 1;
        HEAP[$p187 + 4 | 0] = $nb | 3;
        $mem = $p187 + 8 | 0;
      } else {
        var $call198 = _sys_alloc($167);
        $mem = $call198;
      }
    }
  }
  return $mem;
  return null;
}

_malloc["X"] = 1;

function _tmalloc_small($nb) {
  var __label__;
  var $m_addr;
  var $nb_addr;
  var $t;
  var $v;
  var $rsize;
  var $i;
  var $leastbit;
  var $Y;
  var $K;
  var $N;
  var $trem;
  var $r;
  var $XP;
  var $R;
  var $F;
  var $RP;
  var $CP;
  var $H;
  var $C0;
  var $C1;
  var $DVS;
  var $DV;
  var $I;
  var $B;
  var $F191;
  $m_addr = __gm_;
  $nb_addr = $nb;
  $leastbit = -HEAP[$m_addr + 4 | 0] & HEAP[$m_addr + 4 | 0];
  $Y = $leastbit - 1 | 0;
  $K = $Y >>> 12 & 16;
  $N = $K;
  var $shr4 = $Y >>> ($K >>> 0);
  $Y = $shr4;
  var $and6 = $Y >>> 5 & 8;
  $K = $and6;
  var $add = $and6 + $N | 0;
  $N = $add;
  var $shr7 = $Y >>> ($K >>> 0);
  $Y = $shr7;
  var $and9 = $Y >>> 2 & 4;
  $K = $and9;
  var $add10 = $and9 + $N | 0;
  $N = $add10;
  var $shr11 = $Y >>> ($K >>> 0);
  $Y = $shr11;
  var $and13 = $Y >>> 1 & 2;
  $K = $and13;
  var $add14 = $and13 + $N | 0;
  $N = $add14;
  var $shr15 = $Y >>> ($K >>> 0);
  $Y = $shr15;
  var $and17 = $Y >>> 1 & 1;
  $K = $and17;
  var $add18 = $and17 + $N | 0;
  $N = $add18;
  var $shr19 = $Y >>> ($K >>> 0);
  $Y = $shr19;
  $i = $Y + $N | 0;
  var $29 = HEAP[($i << 2) + $m_addr + 304 | 0];
  $t = $29;
  $v = $29;
  $rsize = (HEAP[$t + 4 | 0] & -8) - $nb_addr | 0;
  while (1) {
    var $child24 = $t + 16 | 0;
    if ((HEAP[$t + 16 | 0] | 0) != 0) {
      var $cond = HEAP[$child24 | 0];
    } else {
      var $cond = HEAP[$child24 + 4 | 0];
    }
    var $cond;
    $t = $cond;
    if (($cond | 0) == 0) {
      break;
    }
    $trem = (HEAP[$t + 4 | 0] & -8) - $nb_addr | 0;
    if ($trem >>> 0 >= $rsize >>> 0) {
      continue;
    }
    $rsize = $trem;
    $v = $t;
  }
  var $tobool = (($v >>> 0 >= HEAP[$m_addr + 16 | 0] >>> 0 & 1) == 1 | 0) != 0;
  do {
    if ($tobool) {
      $r = $v + $nb_addr | 0;
      if ((($v >>> 0 < $r >>> 0 & 1) == 1 | 0) == 0) {
        break;
      }
      $XP = HEAP[$v + 24 | 0];
      var $cmp40 = (HEAP[$v + 12 | 0] | 0) != ($v | 0);
      var $62 = $v;
      do {
        if ($cmp40) {
          $F = HEAP[$62 + 8 | 0];
          $R = HEAP[$v + 12 | 0];
          if ((($F >>> 0 >= HEAP[$m_addr + 16 | 0] >>> 0 & 1) == 1 | 0) != 0) {
            HEAP[$F + 12 | 0] = $R;
            HEAP[$R + 8 | 0] = $F;
          } else {
            _abort();
            throw "Reached an unreachable!";
          }
        } else {
          var $arrayidx55 = $62 + 20 | 0;
          $RP = $arrayidx55;
          var $74 = HEAP[$arrayidx55];
          $R = $74;
          if (($74 | 0) != 0) {
            __label__ = 15;
          } else {
            var $arrayidx59 = $v + 16 | 0;
            $RP = $arrayidx59;
            var $76 = HEAP[$arrayidx59];
            $R = $76;
            if (($76 | 0) == 0) {
              break;
            }
          }
          while (1) {
            var $arrayidx65 = $R + 20 | 0;
            $CP = $arrayidx65;
            if ((HEAP[$arrayidx65] | 0) == 0) {
              var $arrayidx69 = $R + 16 | 0;
              $CP = $arrayidx69;
              if ((HEAP[$arrayidx69] | 0) == 0) {
                break;
              }
            }
            var $81 = $CP;
            $RP = $81;
            $R = HEAP[$81];
          }
          if ((($RP >>> 0 >= HEAP[$m_addr + 16 | 0] >>> 0 & 1) == 1 | 0) != 0) {
            HEAP[$RP] = 0;
          } else {
            _abort();
            throw "Reached an unreachable!";
          }
        }
      } while (0);
      var $cmp84 = ($XP | 0) != 0;
      do {
        if ($cmp84) {
          $H = (HEAP[$v + 28 | 0] << 2) + $m_addr + 304 | 0;
          var $cmp89 = ($v | 0) == (HEAP[$H] | 0);
          do {
            if ($cmp89) {
              var $95 = $R;
              HEAP[$H] = $95;
              if (($95 | 0) != 0) {
                break;
              }
              var $treemap96 = $m_addr + 4 | 0;
              var $and97 = HEAP[$treemap96] & (1 << HEAP[$v + 28 | 0] ^ -1);
              HEAP[$treemap96] = $and97;
            } else {
              if ((($XP >>> 0 >= HEAP[$m_addr + 16 | 0] >>> 0 & 1) == 1 | 0) != 0) {
                var $108 = $R;
                var $child111 = $XP + 16 | 0;
                if ((HEAP[$XP + 16 | 0] | 0) == ($v | 0)) {
                  HEAP[$child111 | 0] = $108;
                } else {
                  HEAP[$child111 + 4 | 0] = $108;
                }
              } else {
                _abort();
                throw "Reached an unreachable!";
              }
            }
          } while (0);
          if (($R | 0) == 0) {
            break;
          }
          if ((($R >>> 0 >= HEAP[$m_addr + 16 | 0] >>> 0 & 1) == 1 | 0) != 0) {
            HEAP[$R + 24 | 0] = $XP;
            var $118 = HEAP[$v + 16 | 0];
            $C0 = $118;
            if (($118 | 0) != 0) {
              if ((($C0 >>> 0 >= HEAP[$m_addr + 16 | 0] >>> 0 & 1) == 1 | 0) != 0) {
                HEAP[$R + 16 | 0] = $C0;
                HEAP[$C0 + 24 | 0] = $R;
              } else {
                _abort();
                throw "Reached an unreachable!";
              }
            }
            var $128 = HEAP[$v + 20 | 0];
            $C1 = $128;
            if (($128 | 0) == 0) {
              break;
            }
            if ((($C1 >>> 0 >= HEAP[$m_addr + 16 | 0] >>> 0 & 1) == 1 | 0) != 0) {
              HEAP[$R + 20 | 0] = $C1;
              HEAP[$C1 + 24 | 0] = $R;
            } else {
              _abort();
              throw "Reached an unreachable!";
            }
          } else {
            _abort();
            throw "Reached an unreachable!";
          }
        }
      } while (0);
      if ($rsize >>> 0 < 16) {
        HEAP[$v + 4 | 0] = $nb_addr + $rsize | 3;
        var $head176 = $rsize + ($nb_addr + ($v + 4)) | 0;
        var $or177 = HEAP[$head176] | 1;
        HEAP[$head176] = $or177;
      } else {
        HEAP[$v + 4 | 0] = $nb_addr | 3;
        HEAP[$r + 4 | 0] = $rsize | 1;
        HEAP[$r + $rsize | 0] = $rsize;
        $DVS = HEAP[$m_addr + 8 | 0];
        if (($DVS | 0) != 0) {
          $DV = HEAP[$m_addr + 20 | 0];
          $I = $DVS >>> 3;
          $B = ($I << 3) + $m_addr + 40 | 0;
          $F191 = $B;
          if ((1 << $I & HEAP[$m_addr | 0] | 0) != 0) {
            if (((HEAP[$B + 8 | 0] >>> 0 >= HEAP[$m_addr + 16 | 0] >>> 0 & 1) == 1 | 0) != 0) {
              $F191 = HEAP[$B + 8 | 0];
            } else {
              _abort();
              throw "Reached an unreachable!";
            }
          } else {
            var $smallmap197 = $m_addr | 0;
            var $or198 = HEAP[$smallmap197] | 1 << $I;
            HEAP[$smallmap197] = $or198;
          }
          HEAP[$B + 8 | 0] = $DV;
          HEAP[$F191 + 12 | 0] = $DV;
          HEAP[$DV + 8 | 0] = $F191;
          HEAP[$DV + 12 | 0] = $B;
        }
        HEAP[$m_addr + 8 | 0] = $rsize;
        HEAP[$m_addr + 20 | 0] = $r;
      }
      return $v + 8 | 0;
    }
  } while (0);
  _abort();
  throw "Reached an unreachable!";
  return null;
}

_tmalloc_small["X"] = 1;

function _tmalloc_large($nb) {
  var __label__;
  var $retval;
  var $m_addr;
  var $nb_addr;
  var $v;
  var $rsize;
  var $t;
  var $idx;
  var $X;
  var $Y;
  var $N;
  var $K;
  var $sizebits;
  var $rst;
  var $rt;
  var $trem;
  var $leftbits;
  var $i;
  var $leastbit;
  var $Y68;
  var $K70;
  var $N73;
  var $trem97;
  var $r;
  var $XP;
  var $R;
  var $F;
  var $RP;
  var $CP;
  var $H;
  var $C0;
  var $C1;
  var $I;
  var $B;
  var $F282;
  var $TP;
  var $H307;
  var $I308;
  var $X309;
  var $Y319;
  var $N320;
  var $K324;
  var $T;
  var $K365;
  var $C;
  var $F404;
  $m_addr = __gm_;
  $nb_addr = $nb;
  $v = 0;
  $rsize = -$nb_addr | 0;
  $X = $nb_addr >>> 8;
  if (($X | 0) == 0) {
    $idx = 0;
  } else {
    if ($X >>> 0 > 65535) {
      $idx = 31;
    } else {
      $Y = $X;
      $N = ($Y - 256 | 0) >>> 16 & 8;
      var $shl = $Y << $N;
      $Y = $shl;
      $K = ($shl - 4096 | 0) >>> 16 & 4;
      var $add = $N + $K | 0;
      $N = $add;
      var $shl9 = $Y << $K;
      $Y = $shl9;
      var $and12 = ($shl9 - 16384 | 0) >>> 16 & 2;
      $K = $and12;
      var $add13 = $and12 + $N | 0;
      $N = $add13;
      var $shl15 = $Y << $K;
      $Y = $shl15;
      var $add17 = -$N + ($shl15 >>> 15) + 14 | 0;
      $K = $add17;
      $idx = ($K << 1) + ($nb_addr >>> (($K + 7 | 0) >>> 0) & 1) | 0;
    }
  }
  var $21 = HEAP[($idx << 2) + $m_addr + 304 | 0];
  $t = $21;
  var $cmp24 = ($21 | 0) != 0;
  do {
    if ($cmp24) {
      if (($idx | 0) == 31) {
        var $cond = 0;
      } else {
        var $cond = -($idx >>> 1) + 25 | 0;
      }
      var $cond;
      $sizebits = $nb_addr << $cond;
      $rst = 0;
      while (1) {
        $trem = (HEAP[$t + 4 | 0] & -8) - $nb_addr | 0;
        if ($trem >>> 0 < $rsize >>> 0) {
          var $30 = $t;
          $v = $30;
          var $31 = $trem;
          $rsize = $31;
          if (($31 | 0) == 0) {
            var $44 = $30;
            break;
          }
        }
        $rt = HEAP[$t + 20 | 0];
        var $36 = HEAP[(($sizebits >>> 31 & 1) << 2) + $t + 16 | 0];
        $t = $36;
        var $cmp45 = ($rt | 0) != 0;
        do {
          if ($cmp45) {
            var $39 = $t;
            if (($rt | 0) == ($39 | 0)) {
              var $41 = $39;
              break;
            }
            $rst = $rt;
            var $41 = $t;
          } else {
            var $41 = $36;
          }
        } while (0);
        var $41;
        if (($41 | 0) == 0) {
          var $42 = $rst;
          $t = $42;
          var $44 = $42;
          break;
        }
        var $shl52 = $sizebits << 1;
        $sizebits = $shl52;
      }
      var $44;
      if (($44 | 0) == 0) {
        __label__ = 18;
        break;
      }
      __label__ = 21;
      break;
    } else {
      __label__ = 18;
    }
  } while (0);
  do {
    if (__label__ == 18) {
      if (($v | 0) != 0) {
        __label__ = 21;
        break;
      }
      $leftbits = (-(1 << $idx << 1) | 1 << $idx << 1) & HEAP[$m_addr + 4 | 0];
      if (($leftbits | 0) == 0) {
        __label__ = 21;
        break;
      }
      $leastbit = -$leftbits & $leftbits;
      $Y68 = $leastbit - 1 | 0;
      $K70 = $Y68 >>> 12 & 16;
      $N73 = $K70;
      var $shr74 = $Y68 >>> ($K70 >>> 0);
      $Y68 = $shr74;
      var $and76 = $Y68 >>> 5 & 8;
      $K70 = $and76;
      var $add77 = $and76 + $N73 | 0;
      $N73 = $add77;
      var $shr78 = $Y68 >>> ($K70 >>> 0);
      $Y68 = $shr78;
      var $and80 = $Y68 >>> 2 & 4;
      $K70 = $and80;
      var $add81 = $and80 + $N73 | 0;
      $N73 = $add81;
      var $shr82 = $Y68 >>> ($K70 >>> 0);
      $Y68 = $shr82;
      var $and84 = $Y68 >>> 1 & 2;
      $K70 = $and84;
      var $add85 = $and84 + $N73 | 0;
      $N73 = $add85;
      var $shr86 = $Y68 >>> ($K70 >>> 0);
      $Y68 = $shr86;
      var $and88 = $Y68 >>> 1 & 1;
      $K70 = $and88;
      var $add89 = $and88 + $N73 | 0;
      $N73 = $add89;
      var $shr90 = $Y68 >>> ($K70 >>> 0);
      $Y68 = $shr90;
      $i = $Y68 + $N73 | 0;
      var $78 = HEAP[($i << 2) + $m_addr + 304 | 0];
      $t = $78;
      var $_ph = $78;
      __label__ = 22;
      break;
    }
  } while (0);
  if (__label__ == 21) {
    var $_ph = $t;
  }
  var $_ph;
  var $cmp964 = ($_ph | 0) != 0;
  $while_body$$while_end$34 : do {
    if ($cmp964) {
      while (1) {
        $trem97 = (HEAP[$t + 4 | 0] & -8) - $nb_addr | 0;
        if ($trem97 >>> 0 < $rsize >>> 0) {
          $rsize = $trem97;
          $v = $t;
        }
        var $child108 = $t + 16 | 0;
        if ((HEAP[$t + 16 | 0] | 0) != 0) {
          var $cond114 = HEAP[$child108 | 0];
        } else {
          var $cond114 = HEAP[$child108 + 4 | 0];
        }
        var $cond114;
        $t = $cond114;
        if (($cond114 | 0) == 0) {
          break $while_body$$while_end$34;
        }
      }
    }
  } while (0);
  var $cmp115 = ($v | 0) != 0;
  $land_lhs_true116$$if_end429$45 : do {
    if ($cmp115) {
      if ($rsize >>> 0 >= (HEAP[$m_addr + 8 | 0] - $nb_addr | 0) >>> 0) {
        __label__ = 97;
        break;
      }
      var $tobool = (($v >>> 0 >= HEAP[$m_addr + 16 | 0] >>> 0 & 1) == 1 | 0) != 0;
      do {
        if ($tobool) {
          $r = $v + $nb_addr | 0;
          if ((($v >>> 0 < $r >>> 0 & 1) == 1 | 0) == 0) {
            break;
          }
          $XP = HEAP[$v + 24 | 0];
          var $cmp127 = (HEAP[$v + 12 | 0] | 0) != ($v | 0);
          var $113 = $v;
          do {
            if ($cmp127) {
              $F = HEAP[$113 + 8 | 0];
              $R = HEAP[$v + 12 | 0];
              if ((($F >>> 0 >= HEAP[$m_addr + 16 | 0] >>> 0 & 1) == 1 | 0) != 0) {
                HEAP[$F + 12 | 0] = $R;
                HEAP[$R + 8 | 0] = $F;
              } else {
                _abort();
                throw "Reached an unreachable!";
              }
            } else {
              var $arrayidx143 = $113 + 20 | 0;
              $RP = $arrayidx143;
              var $125 = HEAP[$arrayidx143];
              $R = $125;
              if (($125 | 0) != 0) {
                __label__ = 39;
              } else {
                var $arrayidx147 = $v + 16 | 0;
                $RP = $arrayidx147;
                var $127 = HEAP[$arrayidx147];
                $R = $127;
                if (($127 | 0) == 0) {
                  break;
                }
              }
              while (1) {
                var $arrayidx153 = $R + 20 | 0;
                $CP = $arrayidx153;
                if ((HEAP[$arrayidx153] | 0) == 0) {
                  var $arrayidx157 = $R + 16 | 0;
                  $CP = $arrayidx157;
                  if ((HEAP[$arrayidx157] | 0) == 0) {
                    break;
                  }
                }
                var $132 = $CP;
                $RP = $132;
                $R = HEAP[$132];
              }
              if ((($RP >>> 0 >= HEAP[$m_addr + 16 | 0] >>> 0 & 1) == 1 | 0) != 0) {
                HEAP[$RP] = 0;
              } else {
                _abort();
                throw "Reached an unreachable!";
              }
            }
          } while (0);
          var $cmp172 = ($XP | 0) != 0;
          do {
            if ($cmp172) {
              $H = (HEAP[$v + 28 | 0] << 2) + $m_addr + 304 | 0;
              var $cmp177 = ($v | 0) == (HEAP[$H] | 0);
              do {
                if ($cmp177) {
                  var $146 = $R;
                  HEAP[$H] = $146;
                  if (($146 | 0) != 0) {
                    break;
                  }
                  var $treemap185 = $m_addr + 4 | 0;
                  var $and186 = HEAP[$treemap185] & (1 << HEAP[$v + 28 | 0] ^ -1);
                  HEAP[$treemap185] = $and186;
                } else {
                  if ((($XP >>> 0 >= HEAP[$m_addr + 16 | 0] >>> 0 & 1) == 1 | 0) != 0) {
                    var $159 = $R;
                    var $child200 = $XP + 16 | 0;
                    if ((HEAP[$XP + 16 | 0] | 0) == ($v | 0)) {
                      HEAP[$child200 | 0] = $159;
                    } else {
                      HEAP[$child200 + 4 | 0] = $159;
                    }
                  } else {
                    _abort();
                    throw "Reached an unreachable!";
                  }
                }
              } while (0);
              if (($R | 0) == 0) {
                break;
              }
              if ((($R >>> 0 >= HEAP[$m_addr + 16 | 0] >>> 0 & 1) == 1 | 0) != 0) {
                HEAP[$R + 24 | 0] = $XP;
                var $169 = HEAP[$v + 16 | 0];
                $C0 = $169;
                if (($169 | 0) != 0) {
                  if ((($C0 >>> 0 >= HEAP[$m_addr + 16 | 0] >>> 0 & 1) == 1 | 0) != 0) {
                    HEAP[$R + 16 | 0] = $C0;
                    HEAP[$C0 + 24 | 0] = $R;
                  } else {
                    _abort();
                    throw "Reached an unreachable!";
                  }
                }
                var $179 = HEAP[$v + 20 | 0];
                $C1 = $179;
                if (($179 | 0) == 0) {
                  break;
                }
                if ((($C1 >>> 0 >= HEAP[$m_addr + 16 | 0] >>> 0 & 1) == 1 | 0) != 0) {
                  HEAP[$R + 20 | 0] = $C1;
                  HEAP[$C1 + 24 | 0] = $R;
                } else {
                  _abort();
                  throw "Reached an unreachable!";
                }
              } else {
                _abort();
                throw "Reached an unreachable!";
              }
            }
          } while (0);
          var $cmp257 = $rsize >>> 0 < 16;
          $if_then259$$if_else268$97 : do {
            if ($cmp257) {
              HEAP[$v + 4 | 0] = $nb_addr + $rsize | 3;
              var $head266 = $rsize + ($nb_addr + ($v + 4)) | 0;
              var $or267 = HEAP[$head266] | 1;
              HEAP[$head266] = $or267;
            } else {
              HEAP[$v + 4 | 0] = $nb_addr | 3;
              HEAP[$r + 4 | 0] = $rsize | 1;
              HEAP[$r + $rsize | 0] = $rsize;
              if ($rsize >>> 3 >>> 0 < 32) {
                $I = $rsize >>> 3;
                $B = ($I << 3) + $m_addr + 40 | 0;
                $F282 = $B;
                if ((1 << $I & HEAP[$m_addr | 0] | 0) != 0) {
                  if (((HEAP[$B + 8 | 0] >>> 0 >= HEAP[$m_addr + 16 | 0] >>> 0 & 1) == 1 | 0) != 0) {
                    $F282 = HEAP[$B + 8 | 0];
                  } else {
                    _abort();
                    throw "Reached an unreachable!";
                  }
                } else {
                  var $smallmap288 = $m_addr | 0;
                  var $or289 = HEAP[$smallmap288] | 1 << $I;
                  HEAP[$smallmap288] = $or289;
                }
                HEAP[$B + 8 | 0] = $r;
                HEAP[$F282 + 12 | 0] = $r;
                HEAP[$r + 8 | 0] = $F282;
                HEAP[$r + 12 | 0] = $B;
              } else {
                $TP = $r;
                $X309 = $rsize >>> 8;
                if (($X309 | 0) == 0) {
                  $I308 = 0;
                } else {
                  if ($X309 >>> 0 > 65535) {
                    $I308 = 31;
                  } else {
                    $Y319 = $X309;
                    $N320 = ($Y319 - 256 | 0) >>> 16 & 8;
                    var $shl325 = $Y319 << $N320;
                    $Y319 = $shl325;
                    $K324 = ($shl325 - 4096 | 0) >>> 16 & 4;
                    var $add329 = $N320 + $K324 | 0;
                    $N320 = $add329;
                    var $shl330 = $Y319 << $K324;
                    $Y319 = $shl330;
                    var $and333 = ($shl330 - 16384 | 0) >>> 16 & 2;
                    $K324 = $and333;
                    var $add334 = $and333 + $N320 | 0;
                    $N320 = $add334;
                    var $shl336 = $Y319 << $K324;
                    $Y319 = $shl336;
                    var $add338 = -$N320 + ($shl336 >>> 15) + 14 | 0;
                    $K324 = $add338;
                    $I308 = ($K324 << 1) + ($rsize >>> (($K324 + 7 | 0) >>> 0) & 1) | 0;
                  }
                }
                $H307 = ($I308 << 2) + $m_addr + 304 | 0;
                HEAP[$TP + 28 | 0] = $I308;
                HEAP[$TP + 20 | 0] = 0;
                HEAP[$TP + 16 | 0] = 0;
                if ((1 << $I308 & HEAP[$m_addr + 4 | 0] | 0) != 0) {
                  $T = HEAP[$H307];
                  if (($I308 | 0) == 31) {
                    var $cond375 = 0;
                  } else {
                    var $cond375 = -($I308 >>> 1) + 25 | 0;
                  }
                  var $cond375;
                  $K365 = $rsize << $cond375;
                  while (1) {
                    if ((HEAP[$T + 4 | 0] & -8 | 0) != ($rsize | 0)) {
                      $C = (($K365 >>> 31 & 1) << 2) + $T + 16 | 0;
                      var $shl387 = $K365 << 1;
                      $K365 = $shl387;
                      var $288 = $C;
                      if ((HEAP[$C] | 0) != 0) {
                        $T = HEAP[$288];
                      } else {
                        if ((($288 >>> 0 >= HEAP[$m_addr + 16 | 0] >>> 0 & 1) == 1 | 0) != 0) {
                          HEAP[$C] = $TP;
                          HEAP[$TP + 24 | 0] = $T;
                          var $297 = $TP;
                          HEAP[$TP + 12 | 0] = $297;
                          HEAP[$TP + 8 | 0] = $297;
                          break $if_then259$$if_else268$97;
                        }
                        _abort();
                        throw "Reached an unreachable!";
                      }
                    } else {
                      $F404 = HEAP[$T + 8 | 0];
                      if ($T >>> 0 >= HEAP[$m_addr + 16 | 0] >>> 0) {
                        var $310 = $F404 >>> 0 >= HEAP[$m_addr + 16 | 0] >>> 0;
                      } else {
                        var $310 = 0;
                      }
                      var $310;
                      if ((($310 & 1) == 1 | 0) != 0) {
                        var $311 = $TP;
                        HEAP[$F404 + 12 | 0] = $311;
                        HEAP[$T + 8 | 0] = $311;
                        HEAP[$TP + 8 | 0] = $F404;
                        HEAP[$TP + 12 | 0] = $T;
                        HEAP[$TP + 24 | 0] = 0;
                        break $if_then259$$if_else268$97;
                      }
                      _abort();
                      throw "Reached an unreachable!";
                    }
                  }
                } else {
                  var $treemap359 = $m_addr + 4 | 0;
                  var $or360 = HEAP[$treemap359] | 1 << $I308;
                  HEAP[$treemap359] = $or360;
                  HEAP[$H307] = $TP;
                  HEAP[$TP + 24 | 0] = $H307;
                  var $272 = $TP;
                  HEAP[$TP + 12 | 0] = $272;
                  HEAP[$TP + 8 | 0] = $272;
                }
              }
            }
          } while (0);
          $retval = $v + 8 | 0;
          __label__ = 98;
          break $land_lhs_true116$$if_end429$45;
        }
      } while (0);
      _abort();
      throw "Reached an unreachable!";
    } else {
      __label__ = 97;
    }
  } while (0);
  if (__label__ == 97) {
    $retval = 0;
  }
  return $retval;
  return null;
}

_tmalloc_large["X"] = 1;

function _sys_alloc($nb) {
  var __label__;
  var $retval;
  var $m_addr;
  var $nb_addr;
  var $tbase;
  var $tsize;
  var $mmap_flag;
  var $br;
  var $ss;
  var $asize;
  var $base;
  var $esize;
  var $end;
  var $asize97;
  var $br106;
  var $end107;
  var $ssize;
  var $mn;
  var $sp;
  var $oldbase;
  var $rsize;
  var $p;
  var $r;
  $m_addr = __gm_;
  $nb_addr = $nb;
  $tbase = -1;
  $tsize = 0;
  $mmap_flag = 0;
  if ((HEAP[_mparams | 0] | 0) == 0) {
    _init_mparams();
  }
  var $tobool11 = (HEAP[$m_addr + 440 | 0] & 4 | 0) != 0;
  $if_end94thread_pre_split$$if_then12$5 : do {
    if (!$tobool11) {
      $br = -1;
      var $cmp13 = (HEAP[$m_addr + 24 | 0] | 0) == 0;
      do {
        if ($cmp13) {
          $ss = 0;
          $asize = 0;
          __label__ = 6;
          break;
        }
        var $8 = HEAP[$m_addr + 24 | 0];
        var $call15 = _segment_holding($m_addr, $8);
        $ss = $call15;
        $asize = 0;
        if (($call15 | 0) == 0) {
          __label__ = 6;
          break;
        }
        $asize = (HEAP[_mparams + 8 | 0] - 1 ^ -1) & $nb_addr + -HEAP[$m_addr + 12 | 0] + HEAP[_mparams + 8 | 0] + 47;
        if ($asize >>> 0 >= 2147483647) {
          __label__ = 16;
          break;
        }
        var $call53 = _sbrk($asize);
        $br = $call53;
        if (($call53 | 0) != (HEAP[$ss | 0] + HEAP[$ss + 4 | 0] | 0)) {
          __label__ = 16;
          break;
        }
        var $38 = $br;
        $tbase = $38;
        $tsize = $asize;
        var $40 = $38;
        __label__ = 17;
        break;
      } while (0);
      do {
        if (__label__ == 6) {
          var $call18 = _sbrk(0);
          $base = $call18;
          if (($call18 | 0) == -1) {
            __label__ = 16;
            break;
          }
          $asize = (HEAP[_mparams + 8 | 0] - 1 ^ -1) & $nb_addr + HEAP[_mparams + 8 | 0] + 47;
          if ((HEAP[_mparams + 4 | 0] - 1 & $base | 0) == 0) {
            var $22 = $asize;
          } else {
            var $add34 = ($base - 1 + HEAP[_mparams + 4 | 0] & (HEAP[_mparams + 4 | 0] - 1 ^ -1)) - $base + $asize | 0;
            $asize = $add34;
            var $22 = $add34;
          }
          var $22;
          if ($22 >>> 0 >= 2147483647) {
            __label__ = 16;
            break;
          }
          var $call38 = _sbrk($asize);
          $br = $call38;
          if (($call38 | 0) != ($base | 0)) {
            __label__ = 16;
            break;
          }
          var $25 = $base;
          $tbase = $25;
          $tsize = $asize;
          var $40 = $25;
          __label__ = 17;
          break;
        }
      } while (0);
      if (__label__ == 16) {
        var $40 = $tbase;
      }
      var $40;
      if (($40 | 0) != -1) {
        __label__ = 28;
        break;
      }
      var $cmp61 = ($br | 0) != -1;
      $if_then62$$if_else90$26 : do {
        if ($cmp61) {
          var $cmp63 = $asize >>> 0 < 2147483647;
          do {
            if ($cmp63) {
              if ($asize >>> 0 >= ($nb_addr + 48 | 0) >>> 0) {
                break;
              }
              $esize = (HEAP[_mparams + 8 | 0] - 1 ^ -1) & $nb_addr + -$asize + HEAP[_mparams + 8 | 0] + 47;
              if ($esize >>> 0 >= 2147483647) {
                break;
              }
              var $call77 = _sbrk($esize);
              $end = $call77;
              if (($end | 0) == -1) {
                var $call83 = _sbrk(-$asize | 0);
                $br = -1;
                break $if_then62$$if_else90$26;
              }
              var $add80 = $asize + $esize | 0;
              $asize = $add80;
            }
          } while (0);
          if (($br | 0) == -1) {
            break;
          }
          var $55 = $br;
          $tbase = $55;
          $tsize = $asize;
          var $59 = $55;
          __label__ = 29;
          break $if_end94thread_pre_split$$if_then12$5;
        }
      } while (0);
      var $mflags91 = $m_addr + 440 | 0;
      var $or = HEAP[$mflags91] | 4;
      HEAP[$mflags91] = $or;
      __label__ = 28;
      break;
    }
    __label__ = 28;
  } while (0);
  if (__label__ == 28) {
    var $59 = $tbase;
  }
  var $59;
  var $cmp95 = ($59 | 0) == -1;
  do {
    if ($cmp95) {
      $asize97 = (HEAP[_mparams + 8 | 0] - 1 ^ -1) & $nb_addr + HEAP[_mparams + 8 | 0] + 47;
      if ($asize97 >>> 0 >= 2147483647) {
        __label__ = 36;
        break;
      }
      $br106 = -1;
      $end107 = -1;
      var $call108 = _sbrk($asize97);
      $br106 = $call108;
      var $call109 = _sbrk(0);
      $end107 = $call109;
      if (($br106 | 0) == -1) {
        __label__ = 36;
        break;
      }
      if (($end107 | 0) == -1) {
        __label__ = 36;
        break;
      }
      if ($br106 >>> 0 >= $end107 >>> 0) {
        __label__ = 36;
        break;
      }
      $ssize = $end107 - $br106 | 0;
      if ($ssize >>> 0 <= ($nb_addr + 40 | 0) >>> 0) {
        __label__ = 36;
        break;
      }
      var $73 = $br106;
      $tbase = $73;
      $tsize = $ssize;
      var $75 = $73;
      __label__ = 37;
      break;
    }
    __label__ = 36;
  } while (0);
  if (__label__ == 36) {
    var $75 = $tbase;
  }
  var $75;
  var $cmp123 = ($75 | 0) != -1;
  $if_then124$$if_end241$51 : do {
    if ($cmp123) {
      var $footprint = $m_addr + 432 | 0;
      var $add125 = HEAP[$footprint] + $tsize | 0;
      HEAP[$footprint] = $add125;
      if ($add125 >>> 0 > HEAP[$m_addr + 436 | 0] >>> 0) {
        var $82 = HEAP[$m_addr + 432 | 0];
        HEAP[$m_addr + 436 | 0] = $82;
      }
      var $cmp132 = (HEAP[$m_addr + 24 | 0] | 0) != 0;
      var $86 = $m_addr;
      $if_else158$$if_then133$56 : do {
        if ($cmp132) {
          var $seg159 = $86 + 444 | 0;
          $sp = $seg159;
          var $122 = $seg159;
          while (1) {
            var $122;
            if (($122 | 0) == 0) {
              var $131 = $sp;
              break;
            }
            var $129 = $sp;
            if (($tbase | 0) == (HEAP[$sp | 0] + HEAP[$sp + 4 | 0] | 0)) {
              var $131 = $129;
              break;
            }
            var $130 = HEAP[$129 + 8 | 0];
            $sp = $130;
            var $122 = $130;
          }
          var $131;
          var $cmp165 = ($131 | 0) != 0;
          do {
            if ($cmp165) {
              if ((HEAP[$sp + 12 | 0] & 8 | 0) != 0) {
                break;
              }
              if (0 != ($mmap_flag | 0)) {
                break;
              }
              if (!(HEAP[$m_addr + 24 | 0] >>> 0 >= HEAP[$sp | 0] >>> 0)) {
                break;
              }
              if (HEAP[$m_addr + 24 | 0] >>> 0 >= (HEAP[$sp | 0] + HEAP[$sp + 4 | 0] | 0) >>> 0) {
                break;
              }
              var $size185 = $sp + 4 | 0;
              var $add186 = HEAP[$size185] + $tsize | 0;
              HEAP[$size185] = $add186;
              var $152 = HEAP[$m_addr + 24 | 0];
              var $add189 = $tsize + HEAP[$m_addr + 12 | 0] | 0;
              _init_top($m_addr, $152, $add189);
              break $if_else158$$if_then133$56;
            }
          } while (0);
          if ($tbase >>> 0 < HEAP[$m_addr + 16 | 0] >>> 0) {
            HEAP[$m_addr + 16 | 0] = $tbase;
          }
          var $seg196 = $m_addr + 444 | 0;
          $sp = $seg196;
          var $162 = $seg196;
          while (1) {
            var $162;
            var $163 = $sp;
            if (($162 | 0) == 0) {
              var $169 = $163;
              break;
            }
            var $167 = $sp;
            if ((HEAP[$163 | 0] | 0) == ($tbase + $tsize | 0)) {
              var $169 = $167;
              break;
            }
            var $168 = HEAP[$167 + 8 | 0];
            $sp = $168;
            var $162 = $168;
          }
          var $169;
          var $cmp207 = ($169 | 0) != 0;
          do {
            if ($cmp207) {
              if ((HEAP[$sp + 12 | 0] & 8 | 0) != 0) {
                break;
              }
              if (0 != ($mmap_flag | 0)) {
                break;
              }
              $oldbase = HEAP[$sp | 0];
              HEAP[$sp | 0] = $tbase;
              var $size219 = $sp + 4 | 0;
              var $add220 = HEAP[$size219] + $tsize | 0;
              HEAP[$size219] = $add220;
              var $call221 = _prepend_alloc($m_addr, $tbase, $oldbase, $nb_addr);
              $retval = $call221;
              __label__ = 72;
              break $if_then124$$if_end241$51;
            }
          } while (0);
          _add_segment($m_addr, $tbase, $tsize, $mmap_flag);
        } else {
          var $cmp134 = (HEAP[$86 + 16 | 0] | 0) == 0;
          do {
            if ($cmp134) {
              __label__ = 43;
            } else {
              if ($tbase >>> 0 < HEAP[$m_addr + 16 | 0] >>> 0) {
                __label__ = 43;
                break;
              }
              __label__ = 44;
              break;
            }
          } while (0);
          if (__label__ == 43) {
            HEAP[$m_addr + 16 | 0] = $tbase;
          }
          HEAP[$m_addr + 444 | 0] = $tbase;
          HEAP[$m_addr + 448 | 0] = $tsize;
          HEAP[$m_addr + 456 | 0] = $mmap_flag;
          var $99 = HEAP[_mparams | 0];
          HEAP[$m_addr + 36 | 0] = $99;
          HEAP[$m_addr + 32 | 0] = -1;
          _init_bins($m_addr);
          var $104 = $m_addr;
          if (($m_addr | 0) == (__gm_ | 0)) {
            _init_top($104, $tbase, $tsize - 40 | 0);
          } else {
            $mn = $104 - 8 + (HEAP[$m_addr - 8 + 4 | 0] & -8) | 0;
            _init_top($m_addr, $mn, $tbase + $tsize - 40 + -$mn | 0);
          }
        }
      } while (0);
      if ($nb_addr >>> 0 >= HEAP[$m_addr + 12 | 0] >>> 0) {
        __label__ = 71;
        break;
      }
      var $topsize229 = $m_addr + 12 | 0;
      var $sub230 = HEAP[$topsize229] - $nb_addr | 0;
      HEAP[$topsize229] = $sub230;
      $rsize = $sub230;
      $p = HEAP[$m_addr + 24 | 0];
      var $199 = $p + $nb_addr | 0;
      HEAP[$m_addr + 24 | 0] = $199;
      $r = $199;
      HEAP[$r + 4 | 0] = $rsize | 1;
      HEAP[$p + 4 | 0] = $nb_addr | 3;
      $retval = $p + 8 | 0;
      __label__ = 72;
      break;
    }
    __label__ = 71;
  } while (0);
  if (__label__ == 71) {
    var $call242 = ___errno();
    HEAP[$call242] = 12;
    $retval = 0;
  }
  return $retval;
  return null;
}

_sys_alloc["X"] = 1;

function _free($mem) {
  var __label__;
  var $mem_addr;
  var $p;
  var $psize;
  var $next;
  var $prevsize;
  var $prev;
  var $F;
  var $B;
  var $I;
  var $TP;
  var $XP;
  var $R;
  var $F60;
  var $RP;
  var $CP;
  var $H;
  var $C0;
  var $C1;
  var $tsize;
  var $dsize;
  var $nsize;
  var $F245;
  var $B247;
  var $I249;
  var $TP285;
  var $XP286;
  var $R288;
  var $F293;
  var $RP306;
  var $CP317;
  var $H343;
  var $C0385;
  var $C1386;
  var $I447;
  var $B449;
  var $F452;
  var $tp;
  var $H475;
  var $I476;
  var $X;
  var $Y;
  var $N;
  var $K;
  var $T;
  var $K525;
  var $C;
  var $F558;
  $mem_addr = $mem;
  var $cmp = ($mem_addr | 0) != 0;
  $if_then$$if_end586$2 : do {
    if ($cmp) {
      $p = $mem_addr - 8 | 0;
      if ($p >>> 0 >= HEAP[__gm_ + 16 | 0] >>> 0) {
        var $8 = (HEAP[$p + 4 | 0] & 3 | 0) != 1;
      } else {
        var $8 = 0;
      }
      var $8;
      var $tobool = (($8 & 1) == 1 | 0) != 0;
      $if_then3$$erroraction$7 : do {
        if ($tobool) {
          $psize = HEAP[$p + 4 | 0] & -8;
          $next = $p + $psize | 0;
          var $tobool9 = (HEAP[$p + 4 | 0] & 1 | 0) != 0;
          do {
            if (!$tobool9) {
              $prevsize = HEAP[$p | 0];
              if ((HEAP[$p + 4 | 0] & 3 | 0) == 0) {
                var $add15 = $psize + ($prevsize + 16) | 0;
                $psize = $add15;
                break $if_then$$if_end586$2;
              }
              $prev = $p + -$prevsize | 0;
              var $add17 = $psize + $prevsize | 0;
              $psize = $add17;
              $p = $prev;
              if ((($prev >>> 0 >= HEAP[__gm_ + 16 | 0] >>> 0 & 1) == 1 | 0) == 0) {
                break $if_then3$$erroraction$7;
              }
              if (($p | 0) == (HEAP[__gm_ + 20 | 0] | 0)) {
                if ((HEAP[$next + 4 | 0] & 3 | 0) != 3) {
                  break;
                }
                HEAP[__gm_ + 8 | 0] = $psize;
                var $head188 = $next + 4 | 0;
                var $and189 = HEAP[$head188] & -2;
                HEAP[$head188] = $and189;
                HEAP[$p + 4 | 0] = $psize | 1;
                HEAP[$p + $psize | 0] = $psize;
                break $if_then$$if_end586$2;
              }
              var $36 = $p;
              if ($prevsize >>> 3 >>> 0 < 32) {
                $F = HEAP[$36 + 8 | 0];
                $B = HEAP[$p + 12 | 0];
                $I = $prevsize >>> 3;
                if (($F | 0) == ($B | 0)) {
                  var $and32 = HEAP[__gm_ | 0] & (1 << $I ^ -1);
                  HEAP[__gm_ | 0] = $and32;
                } else {
                  var $cmp35 = ($F | 0) == (($I << 3) + __gm_ + 40 | 0);
                  do {
                    if ($cmp35) {
                      __label__ = 14;
                    } else {
                      if ($F >>> 0 >= HEAP[__gm_ + 16 | 0] >>> 0) {
                        __label__ = 14;
                        break;
                      }
                      var $59 = 0;
                      __label__ = 16;
                      break;
                    }
                  } while (0);
                  do {
                    if (__label__ == 14) {
                      if (($B | 0) == (($I << 3) + __gm_ + 40 | 0)) {
                        var $59 = 1;
                        break;
                      }
                      var $59 = $B >>> 0 >= HEAP[__gm_ + 16 | 0] >>> 0;
                    }
                  } while (0);
                  var $59;
                  if ((($59 & 1) == 1 | 0) != 0) {
                    HEAP[$F + 12 | 0] = $B;
                    HEAP[$B + 8 | 0] = $F;
                  } else {
                    _abort();
                    throw "Reached an unreachable!";
                  }
                }
              } else {
                $TP = $36;
                $XP = HEAP[$TP + 24 | 0];
                var $cmp57 = (HEAP[$TP + 12 | 0] | 0) != ($TP | 0);
                var $70 = $TP;
                do {
                  if ($cmp57) {
                    $F60 = HEAP[$70 + 8 | 0];
                    $R = HEAP[$TP + 12 | 0];
                    if ((($F60 >>> 0 >= HEAP[__gm_ + 16 | 0] >>> 0 & 1) == 1 | 0) != 0) {
                      HEAP[$F60 + 12 | 0] = $R;
                      HEAP[$R + 8 | 0] = $F60;
                    } else {
                      _abort();
                      throw "Reached an unreachable!";
                    }
                  } else {
                    var $arrayidx73 = $70 + 20 | 0;
                    $RP = $arrayidx73;
                    var $81 = HEAP[$arrayidx73];
                    $R = $81;
                    if (($81 | 0) != 0) {
                      __label__ = 25;
                    } else {
                      var $arrayidx78 = $TP + 16 | 0;
                      $RP = $arrayidx78;
                      var $83 = HEAP[$arrayidx78];
                      $R = $83;
                      if (($83 | 0) == 0) {
                        break;
                      }
                    }
                    while (1) {
                      var $arrayidx83 = $R + 20 | 0;
                      $CP = $arrayidx83;
                      if ((HEAP[$arrayidx83] | 0) == 0) {
                        var $arrayidx88 = $R + 16 | 0;
                        $CP = $arrayidx88;
                        if ((HEAP[$arrayidx88] | 0) == 0) {
                          break;
                        }
                      }
                      var $88 = $CP;
                      $RP = $88;
                      $R = HEAP[$88];
                    }
                    if ((($RP >>> 0 >= HEAP[__gm_ + 16 | 0] >>> 0 & 1) == 1 | 0) != 0) {
                      HEAP[$RP] = 0;
                    } else {
                      _abort();
                      throw "Reached an unreachable!";
                    }
                  }
                } while (0);
                if (($XP | 0) == 0) {
                  break;
                }
                $H = (HEAP[$TP + 28 | 0] << 2) + __gm_ + 304 | 0;
                var $cmp105 = ($TP | 0) == (HEAP[$H] | 0);
                do {
                  if ($cmp105) {
                    var $100 = $R;
                    HEAP[$H] = $100;
                    if (($100 | 0) != 0) {
                      break;
                    }
                    var $and114 = HEAP[__gm_ + 4 | 0] & (1 << HEAP[$TP + 28 | 0] ^ -1);
                    HEAP[__gm_ + 4 | 0] = $and114;
                  } else {
                    if ((($XP >>> 0 >= HEAP[__gm_ + 16 | 0] >>> 0 & 1) == 1 | 0) != 0) {
                      var $111 = $R;
                      var $child127 = $XP + 16 | 0;
                      if ((HEAP[$XP + 16 | 0] | 0) == ($TP | 0)) {
                        HEAP[$child127 | 0] = $111;
                      } else {
                        HEAP[$child127 + 4 | 0] = $111;
                      }
                    } else {
                      _abort();
                      throw "Reached an unreachable!";
                    }
                  }
                } while (0);
                if (($R | 0) == 0) {
                  break;
                }
                if ((($R >>> 0 >= HEAP[__gm_ + 16 | 0] >>> 0 & 1) == 1 | 0) != 0) {
                  HEAP[$R + 24 | 0] = $XP;
                  var $120 = HEAP[$TP + 16 | 0];
                  $C0 = $120;
                  if (($120 | 0) != 0) {
                    if ((($C0 >>> 0 >= HEAP[__gm_ + 16 | 0] >>> 0 & 1) == 1 | 0) != 0) {
                      HEAP[$R + 16 | 0] = $C0;
                      HEAP[$C0 + 24 | 0] = $R;
                    } else {
                      _abort();
                      throw "Reached an unreachable!";
                    }
                  }
                  var $129 = HEAP[$TP + 20 | 0];
                  $C1 = $129;
                  if (($129 | 0) == 0) {
                    break;
                  }
                  if ((($C1 >>> 0 >= HEAP[__gm_ + 16 | 0] >>> 0 & 1) == 1 | 0) != 0) {
                    HEAP[$R + 20 | 0] = $C1;
                    HEAP[$C1 + 24 | 0] = $R;
                  } else {
                    _abort();
                    throw "Reached an unreachable!";
                  }
                } else {
                  _abort();
                  throw "Reached an unreachable!";
                }
              }
            }
          } while (0);
          if ($p >>> 0 < $next >>> 0) {
            var $155 = (HEAP[$next + 4 | 0] & 1 | 0) != 0;
          } else {
            var $155 = 0;
          }
          var $155;
          if ((($155 & 1) == 1 | 0) == 0) {
            break;
          }
          var $tobool212 = (HEAP[$next + 4 | 0] & 2 | 0) != 0;
          var $158 = $next;
          do {
            if ($tobool212) {
              var $head436 = $158 + 4 | 0;
              var $and437 = HEAP[$head436] & -2;
              HEAP[$head436] = $and437;
              HEAP[$p + 4 | 0] = $psize | 1;
              HEAP[$p + $psize | 0] = $psize;
            } else {
              if (($158 | 0) == (HEAP[__gm_ + 24 | 0] | 0)) {
                var $add217 = HEAP[__gm_ + 12 | 0] + $psize | 0;
                HEAP[__gm_ + 12 | 0] = $add217;
                $tsize = $add217;
                HEAP[__gm_ + 24 | 0] = $p;
                HEAP[$p + 4 | 0] = $tsize | 1;
                if (($p | 0) == (HEAP[__gm_ + 20 | 0] | 0)) {
                  HEAP[__gm_ + 20 | 0] = 0;
                  HEAP[__gm_ + 8 | 0] = 0;
                }
                if ($tsize >>> 0 <= HEAP[__gm_ + 28 | 0] >>> 0) {
                  break $if_then$$if_end586$2;
                }
                _sys_trim();
                break $if_then$$if_end586$2;
              }
              if (($next | 0) == (HEAP[__gm_ + 20 | 0] | 0)) {
                var $add232 = HEAP[__gm_ + 8 | 0] + $psize | 0;
                HEAP[__gm_ + 8 | 0] = $add232;
                $dsize = $add232;
                HEAP[__gm_ + 20 | 0] = $p;
                HEAP[$p + 4 | 0] = $dsize | 1;
                HEAP[$p + $dsize | 0] = $dsize;
                break $if_then$$if_end586$2;
              }
              $nsize = HEAP[$next + 4 | 0] & -8;
              var $add240 = $psize + $nsize | 0;
              $psize = $add240;
              var $cmp242 = $nsize >>> 3 >>> 0 < 32;
              var $186 = $next;
              do {
                if ($cmp242) {
                  $F245 = HEAP[$186 + 8 | 0];
                  $B247 = HEAP[$next + 12 | 0];
                  $I249 = $nsize >>> 3;
                  if (($F245 | 0) == ($B247 | 0)) {
                    var $and256 = HEAP[__gm_ | 0] & (1 << $I249 ^ -1);
                    HEAP[__gm_ | 0] = $and256;
                  } else {
                    var $cmp260 = ($F245 | 0) == (($I249 << 3) + __gm_ + 40 | 0);
                    do {
                      if ($cmp260) {
                        __label__ = 69;
                      } else {
                        if ($F245 >>> 0 >= HEAP[__gm_ + 16 | 0] >>> 0) {
                          __label__ = 69;
                          break;
                        }
                        var $209 = 0;
                        __label__ = 71;
                        break;
                      }
                    } while (0);
                    do {
                      if (__label__ == 69) {
                        if (($B247 | 0) == (($I249 << 3) + __gm_ + 40 | 0)) {
                          var $209 = 1;
                          break;
                        }
                        var $209 = $B247 >>> 0 >= HEAP[__gm_ + 16 | 0] >>> 0;
                      }
                    } while (0);
                    var $209;
                    if ((($209 & 1) == 1 | 0) != 0) {
                      HEAP[$F245 + 12 | 0] = $B247;
                      HEAP[$B247 + 8 | 0] = $F245;
                    } else {
                      _abort();
                      throw "Reached an unreachable!";
                    }
                  }
                } else {
                  $TP285 = $186;
                  $XP286 = HEAP[$TP285 + 24 | 0];
                  var $cmp290 = (HEAP[$TP285 + 12 | 0] | 0) != ($TP285 | 0);
                  var $220 = $TP285;
                  do {
                    if ($cmp290) {
                      $F293 = HEAP[$220 + 8 | 0];
                      $R288 = HEAP[$TP285 + 12 | 0];
                      if ((($F293 >>> 0 >= HEAP[__gm_ + 16 | 0] >>> 0 & 1) == 1 | 0) != 0) {
                        HEAP[$F293 + 12 | 0] = $R288;
                        HEAP[$R288 + 8 | 0] = $F293;
                      } else {
                        _abort();
                        throw "Reached an unreachable!";
                      }
                    } else {
                      var $arrayidx308 = $220 + 20 | 0;
                      $RP306 = $arrayidx308;
                      var $231 = HEAP[$arrayidx308];
                      $R288 = $231;
                      if (($231 | 0) != 0) {
                        __label__ = 80;
                      } else {
                        var $arrayidx313 = $TP285 + 16 | 0;
                        $RP306 = $arrayidx313;
                        var $233 = HEAP[$arrayidx313];
                        $R288 = $233;
                        if (($233 | 0) == 0) {
                          break;
                        }
                      }
                      while (1) {
                        var $arrayidx320 = $R288 + 20 | 0;
                        $CP317 = $arrayidx320;
                        if ((HEAP[$arrayidx320] | 0) == 0) {
                          var $arrayidx325 = $R288 + 16 | 0;
                          $CP317 = $arrayidx325;
                          if ((HEAP[$arrayidx325] | 0) == 0) {
                            break;
                          }
                        }
                        var $238 = $CP317;
                        $RP306 = $238;
                        $R288 = HEAP[$238];
                      }
                      if ((($RP306 >>> 0 >= HEAP[__gm_ + 16 | 0] >>> 0 & 1) == 1 | 0) != 0) {
                        HEAP[$RP306] = 0;
                      } else {
                        _abort();
                        throw "Reached an unreachable!";
                      }
                    }
                  } while (0);
                  if (($XP286 | 0) == 0) {
                    break;
                  }
                  $H343 = (HEAP[$TP285 + 28 | 0] << 2) + __gm_ + 304 | 0;
                  var $cmp346 = ($TP285 | 0) == (HEAP[$H343] | 0);
                  do {
                    if ($cmp346) {
                      var $250 = $R288;
                      HEAP[$H343] = $250;
                      if (($250 | 0) != 0) {
                        break;
                      }
                      var $and355 = HEAP[__gm_ + 4 | 0] & (1 << HEAP[$TP285 + 28 | 0] ^ -1);
                      HEAP[__gm_ + 4 | 0] = $and355;
                    } else {
                      if ((($XP286 >>> 0 >= HEAP[__gm_ + 16 | 0] >>> 0 & 1) == 1 | 0) != 0) {
                        var $261 = $R288;
                        var $child368 = $XP286 + 16 | 0;
                        if ((HEAP[$XP286 + 16 | 0] | 0) == ($TP285 | 0)) {
                          HEAP[$child368 | 0] = $261;
                        } else {
                          HEAP[$child368 + 4 | 0] = $261;
                        }
                      } else {
                        _abort();
                        throw "Reached an unreachable!";
                      }
                    }
                  } while (0);
                  if (($R288 | 0) == 0) {
                    break;
                  }
                  if ((($R288 >>> 0 >= HEAP[__gm_ + 16 | 0] >>> 0 & 1) == 1 | 0) != 0) {
                    HEAP[$R288 + 24 | 0] = $XP286;
                    var $270 = HEAP[$TP285 + 16 | 0];
                    $C0385 = $270;
                    if (($270 | 0) != 0) {
                      if ((($C0385 >>> 0 >= HEAP[__gm_ + 16 | 0] >>> 0 & 1) == 1 | 0) != 0) {
                        HEAP[$R288 + 16 | 0] = $C0385;
                        HEAP[$C0385 + 24 | 0] = $R288;
                      } else {
                        _abort();
                        throw "Reached an unreachable!";
                      }
                    }
                    var $279 = HEAP[$TP285 + 20 | 0];
                    $C1386 = $279;
                    if (($279 | 0) == 0) {
                      break;
                    }
                    if ((($C1386 >>> 0 >= HEAP[__gm_ + 16 | 0] >>> 0 & 1) == 1 | 0) != 0) {
                      HEAP[$R288 + 20 | 0] = $C1386;
                      HEAP[$C1386 + 24 | 0] = $R288;
                    } else {
                      _abort();
                      throw "Reached an unreachable!";
                    }
                  } else {
                    _abort();
                    throw "Reached an unreachable!";
                  }
                }
              } while (0);
              HEAP[$p + 4 | 0] = $psize | 1;
              HEAP[$p + $psize | 0] = $psize;
              if (($p | 0) != (HEAP[__gm_ + 20 | 0] | 0)) {
                break;
              }
              HEAP[__gm_ + 8 | 0] = $psize;
              break $if_then$$if_end586$2;
            }
          } while (0);
          if ($psize >>> 3 >>> 0 < 32) {
            $I447 = $psize >>> 3;
            $B449 = ($I447 << 3) + __gm_ + 40 | 0;
            $F452 = $B449;
            if ((1 << $I447 & HEAP[__gm_ | 0] | 0) != 0) {
              if (((HEAP[$B449 + 8 | 0] >>> 0 >= HEAP[__gm_ + 16 | 0] >>> 0 & 1) == 1 | 0) != 0) {
                $F452 = HEAP[$B449 + 8 | 0];
              } else {
                _abort();
                throw "Reached an unreachable!";
              }
            } else {
              var $or458 = HEAP[__gm_ | 0] | 1 << $I447;
              HEAP[__gm_ | 0] = $or458;
            }
            HEAP[$B449 + 8 | 0] = $p;
            HEAP[$F452 + 12 | 0] = $p;
            HEAP[$p + 8 | 0] = $F452;
            HEAP[$p + 12 | 0] = $B449;
            break $if_then$$if_end586$2;
          }
          $tp = $p;
          $X = $psize >>> 8;
          if (($X | 0) == 0) {
            $I476 = 0;
          } else {
            if ($X >>> 0 > 65535) {
              $I476 = 31;
            } else {
              $Y = $X;
              $N = ($Y - 256 | 0) >>> 16 & 8;
              var $shl488 = $Y << $N;
              $Y = $shl488;
              $K = ($shl488 - 4096 | 0) >>> 16 & 4;
              var $add492 = $N + $K | 0;
              $N = $add492;
              var $shl493 = $Y << $K;
              $Y = $shl493;
              var $and496 = ($shl493 - 16384 | 0) >>> 16 & 2;
              $K = $and496;
              var $add497 = $and496 + $N | 0;
              $N = $add497;
              var $shl499 = $Y << $K;
              $Y = $shl499;
              var $add501 = -$N + ($shl499 >>> 15) + 14 | 0;
              $K = $add501;
              $I476 = ($K << 1) + ($psize >>> (($K + 7 | 0) >>> 0) & 1) | 0;
            }
          }
          $H475 = ($I476 << 2) + __gm_ + 304 | 0;
          HEAP[$tp + 28 | 0] = $I476;
          HEAP[$tp + 20 | 0] = 0;
          HEAP[$tp + 16 | 0] = 0;
          var $tobool517 = (1 << $I476 & HEAP[__gm_ + 4 | 0] | 0) != 0;
          $if_else524$$if_then518$175 : do {
            if ($tobool517) {
              $T = HEAP[$H475];
              if (($I476 | 0) == 31) {
                var $cond = 0;
              } else {
                var $cond = -($I476 >>> 1) + 25 | 0;
              }
              var $cond;
              $K525 = $psize << $cond;
              while (1) {
                if ((HEAP[$T + 4 | 0] & -8 | 0) != ($psize | 0)) {
                  $C = (($K525 >>> 31 & 1) << 2) + $T + 16 | 0;
                  var $shl542 = $K525 << 1;
                  $K525 = $shl542;
                  var $379 = $C;
                  if ((HEAP[$C] | 0) != 0) {
                    $T = HEAP[$379];
                  } else {
                    if ((($379 >>> 0 >= HEAP[__gm_ + 16 | 0] >>> 0 & 1) == 1 | 0) != 0) {
                      HEAP[$C] = $tp;
                      HEAP[$tp + 24 | 0] = $T;
                      var $387 = $tp;
                      HEAP[$tp + 12 | 0] = $387;
                      HEAP[$tp + 8 | 0] = $387;
                      break $if_else524$$if_then518$175;
                    }
                    _abort();
                    throw "Reached an unreachable!";
                  }
                } else {
                  $F558 = HEAP[$T + 8 | 0];
                  if ($T >>> 0 >= HEAP[__gm_ + 16 | 0] >>> 0) {
                    var $398 = $F558 >>> 0 >= HEAP[__gm_ + 16 | 0] >>> 0;
                  } else {
                    var $398 = 0;
                  }
                  var $398;
                  if ((($398 & 1) == 1 | 0) != 0) {
                    var $399 = $tp;
                    HEAP[$F558 + 12 | 0] = $399;
                    HEAP[$T + 8 | 0] = $399;
                    HEAP[$tp + 8 | 0] = $F558;
                    HEAP[$tp + 12 | 0] = $T;
                    HEAP[$tp + 24 | 0] = 0;
                    break $if_else524$$if_then518$175;
                  }
                  _abort();
                  throw "Reached an unreachable!";
                }
              }
            } else {
              var $or520 = HEAP[__gm_ + 4 | 0] | 1 << $I476;
              HEAP[__gm_ + 4 | 0] = $or520;
              HEAP[$H475] = $tp;
              HEAP[$tp + 24 | 0] = $H475;
              var $363 = $tp;
              HEAP[$tp + 12 | 0] = $363;
              HEAP[$tp + 8 | 0] = $363;
            }
          } while (0);
          var $dec = HEAP[__gm_ + 32 | 0] - 1 | 0;
          HEAP[__gm_ + 32 | 0] = $dec;
          if (($dec | 0) != 0) {
            break $if_then$$if_end586$2;
          }
          _release_unused_segments();
          break $if_then$$if_end586$2;
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

function _release_unused_segments() {
  var $m_addr;
  var $released;
  var $nsegs;
  var $pred;
  var $sp;
  var $base;
  var $size;
  var $next3;
  $m_addr = __gm_;
  $released = 0;
  $nsegs = 0;
  $pred = $m_addr + 444 | 0;
  var $2 = HEAP[$pred + 8 | 0];
  $sp = $2;
  var $cmp1 = ($2 | 0) != 0;
  $while_body$$while_end256$27 : do {
    if ($cmp1) {
      while (1) {
        $base = HEAP[$sp | 0];
        $size = HEAP[$sp + 4 | 0];
        var $8 = HEAP[$sp + 8 | 0];
        $next3 = $8;
        var $inc = $nsegs + 1 | 0;
        $nsegs = $inc;
        $pred = $sp;
        $sp = $8;
        if (($8 | 0) == 0) {
          break $while_body$$while_end256$27;
        }
      }
    }
  } while (0);
  var $cond262 = $nsegs >>> 0 > 4294967295 ? $nsegs : -1;
  HEAP[$m_addr + 32 | 0] = $cond262;
  return;
  return;
}

function _segment_holding($m, $addr) {
  var $retval;
  var $m_addr;
  var $addr_addr;
  var $sp;
  $m_addr = $m;
  $addr_addr = $addr;
  $sp = $m_addr + 444 | 0;
  $for_cond$40 : while (1) {
    var $cmp = $addr_addr >>> 0 >= HEAP[$sp | 0] >>> 0;
    do {
      if ($cmp) {
        if ($addr_addr >>> 0 >= (HEAP[$sp | 0] + HEAP[$sp + 4 | 0] | 0) >>> 0) {
          break;
        }
        $retval = $sp;
        break $for_cond$40;
      }
    } while (0);
    var $11 = HEAP[$sp + 8 | 0];
    $sp = $11;
    if (($11 | 0) != 0) {
      continue;
    }
    $retval = 0;
    break;
  }
  return $retval;
  return null;
}

function _init_top($m, $p, $psize) {
  var $m_addr;
  var $p_addr;
  var $psize_addr;
  var $offset;
  $m_addr = $m;
  $p_addr = $p;
  $psize_addr = $psize;
  if (($p_addr + 8 & 7 | 0) == 0) {
    var $cond = 0;
  } else {
    var $cond = 8 - ($p_addr + 8 & 7) & 7;
  }
  var $cond;
  $offset = $cond;
  var $9 = $p_addr + $offset | 0;
  $p_addr = $9;
  var $sub5 = $psize_addr - $offset | 0;
  $psize_addr = $sub5;
  HEAP[$m_addr + 24 | 0] = $p_addr;
  HEAP[$m_addr + 12 | 0] = $psize_addr;
  HEAP[$p_addr + 4 | 0] = $psize_addr | 1;
  HEAP[$psize_addr + ($p_addr + 4) | 0] = 40;
  var $22 = HEAP[_mparams + 16 | 0];
  HEAP[$m_addr + 28 | 0] = $22;
  return;
  return;
}

_init_top["X"] = 1;

function _init_bins($m) {
  var $m_addr;
  var $i;
  var $bin;
  $m_addr = $m;
  $i = 0;
  while (1) {
    $bin = ($i << 3) + $m_addr + 40 | 0;
    var $4 = $bin;
    HEAP[$bin + 12 | 0] = $4;
    HEAP[$bin + 8 | 0] = $4;
    var $inc = $i + 1 | 0;
    $i = $inc;
    if ($inc >>> 0 >= 32) {
      break;
    }
  }
  return;
  return;
}

function _sys_trim() {
  var __label__;
  var $m_addr;
  var $pad_addr;
  var $released;
  var $unit;
  var $extra;
  var $sp;
  var $old_br;
  var $rel_br;
  var $new_br;
  $m_addr = __gm_;
  $pad_addr = 0;
  $released = 0;
  if ((HEAP[_mparams | 0] | 0) == 0) {
    _init_mparams();
  }
  var $cmp1 = $pad_addr >>> 0 < 4294967232;
  do {
    if ($cmp1) {
      if ((HEAP[$m_addr + 24 | 0] | 0) == 0) {
        break;
      }
      var $add = $pad_addr + 40 | 0;
      $pad_addr = $add;
      var $cmp3 = HEAP[$m_addr + 12 | 0] >>> 0 > $pad_addr >>> 0;
      do {
        if ($cmp3) {
          $unit = HEAP[_mparams + 8 | 0];
          var $add7 = HEAP[$m_addr + 12 | 0] - 1 + -$pad_addr + $unit | 0;
          var $div = Math.floor(($add7 >>> 0) / ($unit >>> 0));
          $extra = ($div - 1) * $unit | 0;
          var $18 = HEAP[$m_addr + 24 | 0];
          var $call10 = _segment_holding($m_addr, $18);
          $sp = $call10;
          var $tobool11 = (HEAP[$sp + 12 | 0] & 8 | 0) != 0;
          do {
            if (!$tobool11) {
              if ($extra >>> 0 >= 2147483647) {
                $extra = -2147483648 - $unit | 0;
              }
              var $call20 = _sbrk(0);
              $old_br = $call20;
              if (($old_br | 0) != (HEAP[$sp | 0] + HEAP[$sp + 4 | 0] | 0)) {
                __label__ = 12;
                break;
              }
              var $call24 = _sbrk(-$extra | 0);
              $rel_br = $call24;
              var $call25 = _sbrk(0);
              $new_br = $call25;
              if (($rel_br | 0) == -1) {
                __label__ = 12;
                break;
              }
              if ($new_br >>> 0 >= $old_br >>> 0) {
                __label__ = 12;
                break;
              }
              var $sub_ptr_sub = $old_br - $new_br | 0;
              $released = $sub_ptr_sub;
              var $34 = $sub_ptr_sub;
              __label__ = 13;
              break;
            }
            __label__ = 12;
          } while (0);
          if (__label__ == 12) {
            var $34 = $released;
          }
          var $34;
          if (($34 | 0) == 0) {
            break;
          }
          var $size36 = $sp + 4 | 0;
          var $sub37 = HEAP[$size36] - $released | 0;
          HEAP[$size36] = $sub37;
          var $footprint = $m_addr + 432 | 0;
          var $sub38 = HEAP[$footprint] - $released | 0;
          HEAP[$footprint] = $sub38;
          var $43 = HEAP[$m_addr + 24 | 0];
          var $sub41 = HEAP[$m_addr + 12 | 0] - $released | 0;
          _init_top($m_addr, $43, $sub41);
        }
      } while (0);
      if (($released | 0) != 0) {
        break;
      }
      if (HEAP[$m_addr + 12 | 0] >>> 0 <= HEAP[$m_addr + 28 | 0] >>> 0) {
        break;
      }
      HEAP[$m_addr + 28 | 0] = -1;
    }
  } while (0);
  return;
  return;
}

_sys_trim["X"] = 1;

function _init_mparams() {
  var $magic;
  var $psize;
  var $gsize;
  var $cmp = (HEAP[_mparams | 0] | 0) == 0;
  $if_then$$if_end8$32 : do {
    if ($cmp) {
      var $call = _sysconf(8);
      $psize = $call;
      $gsize = $psize;
      var $cmp1 = ($gsize - 1 & $gsize | 0) != 0;
      do {
        if (!$cmp1) {
          if (($psize - 1 & $psize | 0) != 0) {
            break;
          }
          HEAP[_mparams + 8 | 0] = $gsize;
          HEAP[_mparams + 4 | 0] = $psize;
          HEAP[_mparams + 12 | 0] = -1;
          HEAP[_mparams + 16 | 0] = 2097152;
          HEAP[_mparams + 20 | 0] = 0;
          var $8 = HEAP[_mparams + 20 | 0];
          HEAP[__gm_ + 440 | 0] = $8;
          var $call6 = _time(0);
          $magic = $call6 ^ 1431655765;
          var $or = $magic | 8;
          $magic = $or;
          var $and7 = $magic & -8;
          $magic = $and7;
          HEAP[_mparams | 0] = $magic;
          break $if_then$$if_end8$32;
        }
      } while (0);
      _abort();
      throw "Reached an unreachable!";
    }
  } while (0);
  return;
  return;
}

function _prepend_alloc($m, $newbase, $oldbase, $nb) {
  var __label__;
  var $m_addr;
  var $newbase_addr;
  var $oldbase_addr;
  var $nb_addr;
  var $p;
  var $oldfirst;
  var $psize;
  var $q;
  var $qsize;
  var $tsize;
  var $dsize;
  var $nsize;
  var $F;
  var $B;
  var $I;
  var $TP;
  var $XP;
  var $R;
  var $F63;
  var $RP;
  var $CP;
  var $H;
  var $C0;
  var $C1;
  var $I203;
  var $B205;
  var $F209;
  var $TP235;
  var $H236;
  var $I237;
  var $X;
  var $Y;
  var $N;
  var $K;
  var $T;
  var $K290;
  var $C;
  var $F328;
  $m_addr = $m;
  $newbase_addr = $newbase;
  $oldbase_addr = $oldbase;
  $nb_addr = $nb;
  if (($newbase_addr + 8 & 7 | 0) == 0) {
    var $cond = 0;
  } else {
    var $cond = 8 - ($newbase_addr + 8 & 7) & 7;
  }
  var $cond;
  $p = $newbase_addr + $cond | 0;
  if (($oldbase_addr + 8 & 7 | 0) == 0) {
    var $cond15 = 0;
  } else {
    var $cond15 = 8 - ($oldbase_addr + 8 & 7) & 7;
  }
  var $cond15;
  $oldfirst = $oldbase_addr + $cond15 | 0;
  $psize = $oldfirst - $p | 0;
  $q = $p + $nb_addr | 0;
  $qsize = $psize - $nb_addr | 0;
  HEAP[$p + 4 | 0] = $nb_addr | 3;
  var $cmp20 = ($oldfirst | 0) == (HEAP[$m_addr + 24 | 0] | 0);
  $if_then$$if_else$8 : do {
    if ($cmp20) {
      var $topsize = $m_addr + 12 | 0;
      var $add = HEAP[$topsize] + $qsize | 0;
      HEAP[$topsize] = $add;
      $tsize = $add;
      HEAP[$m_addr + 24 | 0] = $q;
      HEAP[$q + 4 | 0] = $tsize | 1;
    } else {
      if (($oldfirst | 0) == (HEAP[$m_addr + 20 | 0] | 0)) {
        var $dvsize = $m_addr + 8 | 0;
        var $add26 = HEAP[$dvsize] + $qsize | 0;
        HEAP[$dvsize] = $add26;
        $dsize = $add26;
        HEAP[$m_addr + 20 | 0] = $q;
        HEAP[$q + 4 | 0] = $dsize | 1;
        HEAP[$q + $dsize | 0] = $dsize;
      } else {
        if ((HEAP[$oldfirst + 4 | 0] & 3 | 0) == 1) {
          $nsize = HEAP[$oldfirst + 4 | 0] & -8;
          var $cmp38 = $nsize >>> 3 >>> 0 < 32;
          var $54 = $oldfirst;
          do {
            if ($cmp38) {
              $F = HEAP[$54 + 8 | 0];
              $B = HEAP[$oldfirst + 12 | 0];
              $I = $nsize >>> 3;
              if (($F | 0) == ($B | 0)) {
                var $smallmap = $m_addr | 0;
                var $and43 = HEAP[$smallmap] & (1 << $I ^ -1);
                HEAP[$smallmap] = $and43;
              } else {
                var $cmp46 = ($F | 0) == (($I << 3) + $m_addr + 40 | 0);
                do {
                  if ($cmp46) {
                    __label__ = 14;
                  } else {
                    if ($F >>> 0 >= HEAP[$m_addr + 16 | 0] >>> 0) {
                      __label__ = 14;
                      break;
                    }
                    var $82 = 0;
                    __label__ = 16;
                    break;
                  }
                } while (0);
                do {
                  if (__label__ == 14) {
                    if (($B | 0) == (($I << 3) + $m_addr + 40 | 0)) {
                      var $82 = 1;
                      break;
                    }
                    var $82 = $B >>> 0 >= HEAP[$m_addr + 16 | 0] >>> 0;
                  }
                } while (0);
                var $82;
                if ((($82 & 1) == 1 | 0) != 0) {
                  HEAP[$F + 12 | 0] = $B;
                  HEAP[$B + 8 | 0] = $F;
                } else {
                  _abort();
                  throw "Reached an unreachable!";
                }
              }
            } else {
              $TP = $54;
              $XP = HEAP[$TP + 24 | 0];
              var $cmp61 = (HEAP[$TP + 12 | 0] | 0) != ($TP | 0);
              var $93 = $TP;
              do {
                if ($cmp61) {
                  $F63 = HEAP[$93 + 8 | 0];
                  $R = HEAP[$TP + 12 | 0];
                  if ((($F63 >>> 0 >= HEAP[$m_addr + 16 | 0] >>> 0 & 1) == 1 | 0) != 0) {
                    HEAP[$F63 + 12 | 0] = $R;
                    HEAP[$R + 8 | 0] = $F63;
                  } else {
                    _abort();
                    throw "Reached an unreachable!";
                  }
                } else {
                  var $arrayidx76 = $93 + 20 | 0;
                  $RP = $arrayidx76;
                  var $105 = HEAP[$arrayidx76];
                  $R = $105;
                  if (($105 | 0) != 0) {
                    __label__ = 25;
                  } else {
                    var $arrayidx81 = $TP + 16 | 0;
                    $RP = $arrayidx81;
                    var $107 = HEAP[$arrayidx81];
                    $R = $107;
                    if (($107 | 0) == 0) {
                      break;
                    }
                  }
                  while (1) {
                    var $arrayidx86 = $R + 20 | 0;
                    $CP = $arrayidx86;
                    if ((HEAP[$arrayidx86] | 0) == 0) {
                      var $arrayidx91 = $R + 16 | 0;
                      $CP = $arrayidx91;
                      if ((HEAP[$arrayidx91] | 0) == 0) {
                        break;
                      }
                    }
                    var $112 = $CP;
                    $RP = $112;
                    $R = HEAP[$112];
                  }
                  if ((($RP >>> 0 >= HEAP[$m_addr + 16 | 0] >>> 0 & 1) == 1 | 0) != 0) {
                    HEAP[$RP] = 0;
                  } else {
                    _abort();
                    throw "Reached an unreachable!";
                  }
                }
              } while (0);
              if (($XP | 0) == 0) {
                break;
              }
              $H = (HEAP[$TP + 28 | 0] << 2) + $m_addr + 304 | 0;
              var $cmp109 = ($TP | 0) == (HEAP[$H] | 0);
              do {
                if ($cmp109) {
                  var $126 = $R;
                  HEAP[$H] = $126;
                  if (($126 | 0) != 0) {
                    break;
                  }
                  var $treemap = $m_addr + 4 | 0;
                  var $and118 = HEAP[$treemap] & (1 << HEAP[$TP + 28 | 0] ^ -1);
                  HEAP[$treemap] = $and118;
                } else {
                  if ((($XP >>> 0 >= HEAP[$m_addr + 16 | 0] >>> 0 & 1) == 1 | 0) != 0) {
                    var $139 = $R;
                    var $child132 = $XP + 16 | 0;
                    if ((HEAP[$XP + 16 | 0] | 0) == ($TP | 0)) {
                      HEAP[$child132 | 0] = $139;
                    } else {
                      HEAP[$child132 + 4 | 0] = $139;
                    }
                  } else {
                    _abort();
                    throw "Reached an unreachable!";
                  }
                }
              } while (0);
              if (($R | 0) == 0) {
                break;
              }
              if ((($R >>> 0 >= HEAP[$m_addr + 16 | 0] >>> 0 & 1) == 1 | 0) != 0) {
                HEAP[$R + 24 | 0] = $XP;
                var $149 = HEAP[$TP + 16 | 0];
                $C0 = $149;
                if (($149 | 0) != 0) {
                  if ((($C0 >>> 0 >= HEAP[$m_addr + 16 | 0] >>> 0 & 1) == 1 | 0) != 0) {
                    HEAP[$R + 16 | 0] = $C0;
                    HEAP[$C0 + 24 | 0] = $R;
                  } else {
                    _abort();
                    throw "Reached an unreachable!";
                  }
                }
                var $159 = HEAP[$TP + 20 | 0];
                $C1 = $159;
                if (($159 | 0) == 0) {
                  break;
                }
                if ((($C1 >>> 0 >= HEAP[$m_addr + 16 | 0] >>> 0 & 1) == 1 | 0) != 0) {
                  HEAP[$R + 20 | 0] = $C1;
                  HEAP[$C1 + 24 | 0] = $R;
                } else {
                  _abort();
                  throw "Reached an unreachable!";
                }
              } else {
                _abort();
                throw "Reached an unreachable!";
              }
            }
          } while (0);
          var $171 = $oldfirst + $nsize | 0;
          $oldfirst = $171;
          var $add191 = $qsize + $nsize | 0;
          $qsize = $add191;
        }
        var $head193 = $oldfirst + 4 | 0;
        var $and194 = HEAP[$head193] & -2;
        HEAP[$head193] = $and194;
        HEAP[$q + 4 | 0] = $qsize | 1;
        HEAP[$q + $qsize | 0] = $qsize;
        if ($qsize >>> 3 >>> 0 < 32) {
          $I203 = $qsize >>> 3;
          $B205 = ($I203 << 3) + $m_addr + 40 | 0;
          $F209 = $B205;
          if ((1 << $I203 & HEAP[$m_addr | 0] | 0) != 0) {
            if (((HEAP[$B205 + 8 | 0] >>> 0 >= HEAP[$m_addr + 16 | 0] >>> 0 & 1) == 1 | 0) != 0) {
              $F209 = HEAP[$B205 + 8 | 0];
            } else {
              _abort();
              throw "Reached an unreachable!";
            }
          } else {
            var $smallmap216 = $m_addr | 0;
            var $or217 = HEAP[$smallmap216] | 1 << $I203;
            HEAP[$smallmap216] = $or217;
          }
          HEAP[$B205 + 8 | 0] = $q;
          HEAP[$F209 + 12 | 0] = $q;
          HEAP[$q + 8 | 0] = $F209;
          HEAP[$q + 12 | 0] = $B205;
        } else {
          $TP235 = $q;
          $X = $qsize >>> 8;
          if (($X | 0) == 0) {
            $I237 = 0;
          } else {
            if ($X >>> 0 > 65535) {
              $I237 = 31;
            } else {
              $Y = $X;
              $N = ($Y - 256 | 0) >>> 16 & 8;
              var $shl250 = $Y << $N;
              $Y = $shl250;
              $K = ($shl250 - 4096 | 0) >>> 16 & 4;
              var $add254 = $N + $K | 0;
              $N = $add254;
              var $shl255 = $Y << $K;
              $Y = $shl255;
              var $and258 = ($shl255 - 16384 | 0) >>> 16 & 2;
              $K = $and258;
              var $add259 = $and258 + $N | 0;
              $N = $add259;
              var $shl261 = $Y << $K;
              $Y = $shl261;
              var $add263 = -$N + ($shl261 >>> 15) + 14 | 0;
              $K = $add263;
              $I237 = ($K << 1) + ($qsize >>> (($K + 7 | 0) >>> 0) & 1) | 0;
            }
          }
          $H236 = ($I237 << 2) + $m_addr + 304 | 0;
          HEAP[$TP235 + 28 | 0] = $I237;
          HEAP[$TP235 + 20 | 0] = 0;
          HEAP[$TP235 + 16 | 0] = 0;
          if ((1 << $I237 & HEAP[$m_addr + 4 | 0] | 0) != 0) {
            $T = HEAP[$H236];
            if (($I237 | 0) == 31) {
              var $cond300 = 0;
            } else {
              var $cond300 = -($I237 >>> 1) + 25 | 0;
            }
            var $cond300;
            $K290 = $qsize << $cond300;
            while (1) {
              if ((HEAP[$T + 4 | 0] & -8 | 0) != ($qsize | 0)) {
                $C = (($K290 >>> 31 & 1) << 2) + $T + 16 | 0;
                var $shl311 = $K290 << 1;
                $K290 = $shl311;
                var $264 = $C;
                if ((HEAP[$C] | 0) != 0) {
                  $T = HEAP[$264];
                } else {
                  if ((($264 >>> 0 >= HEAP[$m_addr + 16 | 0] >>> 0 & 1) == 1 | 0) != 0) {
                    HEAP[$C] = $TP235;
                    HEAP[$TP235 + 24 | 0] = $T;
                    var $273 = $TP235;
                    HEAP[$TP235 + 12 | 0] = $273;
                    HEAP[$TP235 + 8 | 0] = $273;
                    break $if_then$$if_else$8;
                  }
                  _abort();
                  throw "Reached an unreachable!";
                }
              } else {
                $F328 = HEAP[$T + 8 | 0];
                if ($T >>> 0 >= HEAP[$m_addr + 16 | 0] >>> 0) {
                  var $286 = $F328 >>> 0 >= HEAP[$m_addr + 16 | 0] >>> 0;
                } else {
                  var $286 = 0;
                }
                var $286;
                if ((($286 & 1) == 1 | 0) != 0) {
                  var $287 = $TP235;
                  HEAP[$F328 + 12 | 0] = $287;
                  HEAP[$T + 8 | 0] = $287;
                  HEAP[$TP235 + 8 | 0] = $F328;
                  HEAP[$TP235 + 12 | 0] = $T;
                  HEAP[$TP235 + 24 | 0] = 0;
                  break $if_then$$if_else$8;
                }
                _abort();
                throw "Reached an unreachable!";
              }
            }
          } else {
            var $treemap284 = $m_addr + 4 | 0;
            var $or285 = HEAP[$treemap284] | 1 << $I237;
            HEAP[$treemap284] = $or285;
            HEAP[$H236] = $TP235;
            HEAP[$TP235 + 24 | 0] = $H236;
            var $248 = $TP235;
            HEAP[$TP235 + 12 | 0] = $248;
            HEAP[$TP235 + 8 | 0] = $248;
          }
        }
      }
    }
  } while (0);
  return $p + 8 | 0;
  return null;
}

_prepend_alloc["X"] = 1;

function _add_segment($m, $tbase, $tsize, $mmapped) {
  var $m_addr;
  var $tbase_addr;
  var $tsize_addr;
  var $mmapped_addr;
  var $old_top;
  var $oldsp;
  var $old_end;
  var $ssize;
  var $rawsp;
  var $offset;
  var $asp;
  var $csp;
  var $sp;
  var $ss;
  var $tnext;
  var $p;
  var $nfences;
  var $nextp;
  var $q;
  var $psize;
  var $tn;
  var $I;
  var $B;
  var $F;
  var $TP;
  var $H;
  var $I57;
  var $X;
  var $Y;
  var $N;
  var $K;
  var $T;
  var $K105;
  var $C;
  var $F144;
  $m_addr = $m;
  $tbase_addr = $tbase;
  $tsize_addr = $tsize;
  $mmapped_addr = $mmapped;
  $old_top = HEAP[$m_addr + 24 | 0];
  var $call = _segment_holding($m_addr, $old_top);
  $oldsp = $call;
  $old_end = HEAP[$oldsp | 0] + HEAP[$oldsp + 4 | 0] | 0;
  $ssize = 24;
  $rawsp = $old_end + -($ssize + 23) | 0;
  if (($rawsp + 8 & 7 | 0) == 0) {
    var $cond = 0;
  } else {
    var $cond = 8 - ($rawsp + 8 & 7) & 7;
  }
  var $cond;
  $offset = $cond;
  $asp = $rawsp + $offset | 0;
  var $cond13 = $asp >>> 0 < ($old_top + 16 | 0) >>> 0 ? $old_top : $asp;
  $csp = $cond13;
  $sp = $csp;
  $ss = $sp + 8 | 0;
  $tnext = $sp + $ssize | 0;
  $p = $tnext;
  $nfences = 0;
  _init_top($m_addr, $tbase_addr, $tsize_addr - 40 | 0);
  HEAP[$sp + 4 | 0] = $ssize | 3;
  var $39 = $ss;
  var $40 = $m_addr + 444 | 0;
  for (var $$src = $40, $$dest = $39, $$stop = $$src + 16; $$src < $$stop; $$src++, $$dest++) {
    HEAP[$$dest] = HEAP[$$src];
  }
  HEAP[$m_addr + 444 | 0] = $tbase_addr;
  HEAP[$m_addr + 448 | 0] = $tsize_addr;
  HEAP[$m_addr + 456 | 0] = $mmapped_addr;
  HEAP[$m_addr + 452 | 0] = $ss;
  $nextp = $p + 4 | 0;
  HEAP[$p + 4 | 0] = 7;
  var $inc3 = $nfences + 1 | 0;
  $nfences = $inc3;
  var $cmp275 = ($nextp + 4 | 0) >>> 0 < $old_end >>> 0;
  $if_then$$for_end$5 : do {
    if ($cmp275) {
      while (1) {
        $p = $nextp;
        $nextp = $p + 4 | 0;
        HEAP[$p + 4 | 0] = 7;
        var $inc = $nfences + 1 | 0;
        $nfences = $inc;
        if (($nextp + 4 | 0) >>> 0 >= $old_end >>> 0) {
          break $if_then$$for_end$5;
        }
      }
    }
  } while (0);
  var $cmp28 = ($csp | 0) != ($old_top | 0);
  $if_then29$$if_end165$9 : do {
    if ($cmp28) {
      $q = $old_top;
      $psize = $csp - $old_top | 0;
      $tn = $q + $psize | 0;
      var $head31 = $tn + 4 | 0;
      var $and32 = HEAP[$head31] & -2;
      HEAP[$head31] = $and32;
      HEAP[$q + 4 | 0] = $psize | 1;
      HEAP[$q + $psize | 0] = $psize;
      if ($psize >>> 3 >>> 0 < 32) {
        $I = $psize >>> 3;
        $B = ($I << 3) + $m_addr + 40 | 0;
        $F = $B;
        if ((1 << $I & HEAP[$m_addr | 0] | 0) != 0) {
          if (((HEAP[$B + 8 | 0] >>> 0 >= HEAP[$m_addr + 16 | 0] >>> 0 & 1) == 1 | 0) != 0) {
            $F = HEAP[$B + 8 | 0];
          } else {
            _abort();
            throw "Reached an unreachable!";
          }
        } else {
          var $smallmap43 = $m_addr | 0;
          var $or44 = HEAP[$smallmap43] | 1 << $I;
          HEAP[$smallmap43] = $or44;
        }
        HEAP[$B + 8 | 0] = $q;
        HEAP[$F + 12 | 0] = $q;
        HEAP[$q + 8 | 0] = $F;
        HEAP[$q + 12 | 0] = $B;
      } else {
        $TP = $q;
        $X = $psize >>> 8;
        if (($X | 0) == 0) {
          $I57 = 0;
        } else {
          if ($X >>> 0 > 65535) {
            $I57 = 31;
          } else {
            $Y = $X;
            $N = ($Y - 256 | 0) >>> 16 & 8;
            var $shl70 = $Y << $N;
            $Y = $shl70;
            $K = ($shl70 - 4096 | 0) >>> 16 & 4;
            var $add74 = $N + $K | 0;
            $N = $add74;
            var $shl75 = $Y << $K;
            $Y = $shl75;
            var $and78 = ($shl75 - 16384 | 0) >>> 16 & 2;
            $K = $and78;
            var $add79 = $and78 + $N | 0;
            $N = $add79;
            var $shl81 = $Y << $K;
            $Y = $shl81;
            var $add83 = -$N + ($shl81 >>> 15) + 14 | 0;
            $K = $add83;
            $I57 = ($K << 1) + ($psize >>> (($K + 7 | 0) >>> 0) & 1) | 0;
          }
        }
        $H = ($I57 << 2) + $m_addr + 304 | 0;
        HEAP[$TP + 28 | 0] = $I57;
        HEAP[$TP + 20 | 0] = 0;
        HEAP[$TP + 16 | 0] = 0;
        if ((1 << $I57 & HEAP[$m_addr + 4 | 0] | 0) != 0) {
          $T = HEAP[$H];
          if (($I57 | 0) == 31) {
            var $cond115 = 0;
          } else {
            var $cond115 = -($I57 >>> 1) + 25 | 0;
          }
          var $cond115;
          $K105 = $psize << $cond115;
          while (1) {
            if ((HEAP[$T + 4 | 0] & -8 | 0) != ($psize | 0)) {
              $C = (($K105 >>> 31 & 1) << 2) + $T + 16 | 0;
              var $shl127 = $K105 << 1;
              $K105 = $shl127;
              var $166 = $C;
              if ((HEAP[$C] | 0) != 0) {
                $T = HEAP[$166];
              } else {
                if ((($166 >>> 0 >= HEAP[$m_addr + 16 | 0] >>> 0 & 1) == 1 | 0) != 0) {
                  HEAP[$C] = $TP;
                  HEAP[$TP + 24 | 0] = $T;
                  var $175 = $TP;
                  HEAP[$TP + 12 | 0] = $175;
                  HEAP[$TP + 8 | 0] = $175;
                  break $if_then29$$if_end165$9;
                }
                _abort();
                throw "Reached an unreachable!";
              }
            } else {
              $F144 = HEAP[$T + 8 | 0];
              if ($T >>> 0 >= HEAP[$m_addr + 16 | 0] >>> 0) {
                var $188 = $F144 >>> 0 >= HEAP[$m_addr + 16 | 0] >>> 0;
              } else {
                var $188 = 0;
              }
              var $188;
              if ((($188 & 1) == 1 | 0) != 0) {
                var $189 = $TP;
                HEAP[$F144 + 12 | 0] = $189;
                HEAP[$T + 8 | 0] = $189;
                HEAP[$TP + 8 | 0] = $F144;
                HEAP[$TP + 12 | 0] = $T;
                HEAP[$TP + 24 | 0] = 0;
                break $if_then29$$if_end165$9;
              }
              _abort();
              throw "Reached an unreachable!";
            }
          }
        } else {
          var $treemap100 = $m_addr + 4 | 0;
          var $or101 = HEAP[$treemap100] | 1 << $I57;
          HEAP[$treemap100] = $or101;
          HEAP[$H] = $TP;
          HEAP[$TP + 24 | 0] = $H;
          var $150 = $TP;
          HEAP[$TP + 12 | 0] = $150;
          HEAP[$TP + 8 | 0] = $150;
        }
      }
    }
  } while (0);
  return;
  return;
}

_add_segment["X"] = 1;

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
  HEAP[___setErrNo.ret] = value;
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

function _pread(fildes, buf, nbyte, offset) {
  var stream = FS.streams[fildes];
  if (!stream || stream.object.isDevice) {
    ___setErrNo(ERRNO_CODES.EBADF);
    return -1;
  } else if (!stream.isRead) {
    ___setErrNo(ERRNO_CODES.EACCES);
    return -1;
  } else if (stream.object.isFolder) {
    ___setErrNo(ERRNO_CODES.EISDIR);
    return -1;
  } else if (nbyte < 0 || offset < 0) {
    ___setErrNo(ERRNO_CODES.EINVAL);
    return -1;
  } else {
    var bytesRead = 0;
    while (stream.ungotten.length && nbyte > 0) {
      HEAP[buf++] = stream.ungotten.pop();
      nbyte--;
      bytesRead++;
    }
    var contents = stream.object.contents;
    var size = Math.min(contents.length - offset, nbyte);
    for (var i = 0; i < size; i++) {
      HEAP[buf + i] = contents[offset + i];
      bytesRead++;
    }
    return bytesRead;
  }
}

function _read(fildes, buf, nbyte) {
  var stream = FS.streams[fildes];
  if (!stream) {
    ___setErrNo(ERRNO_CODES.EBADF);
    return -1;
  } else if (!stream.isRead) {
    ___setErrNo(ERRNO_CODES.EACCES);
    return -1;
  } else if (nbyte < 0) {
    ___setErrNo(ERRNO_CODES.EINVAL);
    return -1;
  } else {
    var bytesRead;
    if (stream.object.isDevice) {
      if (stream.object.input) {
        bytesRead = 0;
        while (stream.ungotten.length && nbyte > 0) {
          HEAP[buf++] = stream.ungotten.pop();
          nbyte--;
          bytesRead++;
        }
        for (var i = 0; i < nbyte; i++) {
          try {
            var result = stream.object.input();
          } catch (e) {
            ___setErrNo(ERRNO_CODES.EIO);
            return -1;
          }
          if (result === null || result === undefined) break;
          bytesRead++;
          HEAP[buf + i] = result;
        }
        return bytesRead;
      } else {
        ___setErrNo(ERRNO_CODES.ENXIO);
        return -1;
      }
    } else {
      var ungotSize = stream.ungotten.length;
      bytesRead = _pread(fildes, buf, nbyte, stream.position);
      if (bytesRead != -1) {
        stream.position += stream.ungotten.length - ungotSize + bytesRead;
      }
      return bytesRead;
    }
  }
}

function _fread(ptr, size, nitems, stream) {
  var bytesToRead = nitems * size;
  if (bytesToRead == 0) return 0;
  var bytesRead = _read(stream, ptr, bytesToRead);
  var streamObj = FS.streams[stream];
  if (bytesRead == -1) {
    if (streamObj) streamObj.error = true;
    return -1;
  } else {
    if (bytesRead < bytesToRead) streamObj.eof = true;
    return Math.floor(bytesRead / size);
  }
}

function _ferror(stream) {
  return Number(stream in FS.streams && FS.streams[stream].error);
}

function _feof(stream) {
  return Number(stream in FS.streams && FS.streams[stream].eof);
}

function ___assert_func(filename, line, func, condition) {
  throw "Assertion failed: " + Pointer_stringify(condition) + ", at: " + [ Pointer_stringify(filename), line, Pointer_stringify(func) ];
}

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
      contents[offset + i] = HEAP[buf + i];
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
            stream.object.output(HEAP[buf + i]);
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

function _strncmp(px, py, n) {
  var i = 0;
  while (i < n) {
    var x = HEAP[px + i];
    var y = HEAP[py + i];
    if (x == y && x == 0) return 0;
    if (x == 0) return -1;
    if (y == 0) return 1;
    if (x == y) {
      i++;
      continue;
    } else {
      return x > y ? 1 : -1;
    }
  }
  return 0;
}

function _strcmp(px, py) {
  return _strncmp(px, py, TOTAL_MEMORY);
}

function _memset(ptr, value, num, align) {
  for (var $$dest = ptr, $$stop = $$dest + num; $$dest < $$stop; $$dest++) {
    HEAP[$$dest] = value;
  }
}

var _llvm_memset_p0i8_i32 = _memset;

function _memcpy(dest, src, num, align) {
  for (var $$src = src, $$dest = dest, $$stop = $$src + num; $$src < $$stop; $$src++, $$dest++) {
    HEAP[$$dest] = HEAP[$$src];
  }
}

var _llvm_memcpy_p0i8_p0i8_i32 = _memcpy;

var _llvm_dbg_declare;

var _llvm_expect_i32;

function _abort(code) {
  ABORT = true;
  throw "ABORT: " + code + ", at " + (new Error).stack;
}

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
    HEAP[ptr] = ret;
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

var __impure_ptr;

var _configuration_table;

var _inflate_order;

var _fixedtables_lenfix;

var _fixedtables_distfix;

var _static_l_desc;

var _static_d_desc;

var _static_bl_desc;

var _static_ltree;

var _static_dtree;

var _extra_lbits;

var _base_length;

var _extra_dbits;

var _base_dist;

var _extra_blbits;

var _crc_table;

var _inflate_table_lbase;

var _inflate_table_lext;

var _inflate_table_dbase;

var _inflate_table_dext;

var __gm_;

var _mparams;

STRING_TABLE.__str = allocate([ 49, 46, 50, 46, 53, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str1 = allocate([ 122, 112, 105, 112, 101, 46, 99, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.___func___def = allocate([ 100, 101, 102, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str2 = allocate([ 114, 101, 116, 32, 33, 61, 32, 90, 95, 83, 84, 82, 69, 65, 77, 95, 69, 82, 82, 79, 82, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str3 = allocate([ 115, 116, 114, 109, 46, 97, 118, 97, 105, 108, 95, 105, 110, 32, 61, 61, 32, 48, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str4 = allocate([ 114, 101, 116, 32, 61, 61, 32, 90, 95, 83, 84, 82, 69, 65, 77, 95, 69, 78, 68, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.___func___inf = allocate([ 105, 110, 102, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str5 = allocate([ 122, 112, 105, 112, 101, 58, 32, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str6 = allocate([ 101, 114, 114, 111, 114, 32, 114, 101, 97, 100, 105, 110, 103, 32, 115, 116, 100, 105, 110, 10, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str7 = allocate([ 101, 114, 114, 111, 114, 32, 119, 114, 105, 116, 105, 110, 103, 32, 115, 116, 100, 111, 117, 116, 10, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str8 = allocate([ 105, 110, 118, 97, 108, 105, 100, 32, 99, 111, 109, 112, 114, 101, 115, 115, 105, 111, 110, 32, 108, 101, 118, 101, 108, 10, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str9 = allocate([ 105, 110, 118, 97, 108, 105, 100, 32, 111, 114, 32, 105, 110, 99, 111, 109, 112, 108, 101, 116, 101, 32, 100, 101, 102, 108, 97, 116, 101, 32, 100, 97, 116, 97, 10, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str10 = allocate([ 111, 117, 116, 32, 111, 102, 32, 109, 101, 109, 111, 114, 121, 10, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str11 = allocate([ 122, 108, 105, 98, 32, 118, 101, 114, 115, 105, 111, 110, 32, 109, 105, 115, 109, 97, 116, 99, 104, 33, 10, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str12 = allocate([ 45, 100, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str13 = allocate([ 122, 112, 105, 112, 101, 32, 117, 115, 97, 103, 101, 58, 32, 122, 112, 105, 112, 101, 32, 91, 45, 100, 93, 32, 60, 32, 115, 111, 117, 114, 99, 101, 32, 62, 32, 100, 101, 115, 116, 10, 0 ], "i8", ALLOC_STATIC);

_configuration_table = allocate([ 0, 0, 0, 0, 0, 0, 0, 0, 6, 0, 0, 0, 4, 0, 4, 0, 8, 0, 4, 0, 8, 0, 0, 0, 4, 0, 5, 0, 16, 0, 8, 0, 8, 0, 0, 0, 4, 0, 6, 0, 32, 0, 32, 0, 8, 0, 0, 0, 4, 0, 4, 0, 16, 0, 16, 0, 10, 0, 0, 0, 8, 0, 16, 0, 32, 0, 32, 0, 10, 0, 0, 0, 8, 0, 16, 0, 128, 0, 128, 0, 10, 0, 0, 0, 8, 0, 32, 0, 128, 0, 256, 0, 10, 0, 0, 0, 32, 0, 128, 0, 258, 0, 1024, 0, 10, 0, 0, 0, 32, 0, 258, 0, 258, 0, 4096, 0, 10, 0, 0, 0 ], [ "i16", 0, "i16", 0, "i16", 0, "i16", 0, "*", 0, 0, 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "*", 0, 0, 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "*", 0, 0, 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "*", 0, 0, 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "*", 0, 0, 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "*", 0, 0, 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "*", 0, 0, 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "*", 0, 0, 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "*", 0, 0, 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "*", 0, 0, 0 ], ALLOC_STATIC);

_inflate_order = allocate([ 16, 0, 17, 0, 18, 0, 0, 0, 8, 0, 7, 0, 9, 0, 6, 0, 10, 0, 5, 0, 11, 0, 4, 0, 12, 0, 3, 0, 13, 0, 2, 0, 14, 0, 1, 0, 15, 0 ], [ "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0 ], ALLOC_STATIC);

STRING_TABLE.__str115 = allocate([ 105, 110, 99, 111, 114, 114, 101, 99, 116, 32, 104, 101, 97, 100, 101, 114, 32, 99, 104, 101, 99, 107, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str216 = allocate([ 117, 110, 107, 110, 111, 119, 110, 32, 99, 111, 109, 112, 114, 101, 115, 115, 105, 111, 110, 32, 109, 101, 116, 104, 111, 100, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str317 = allocate([ 105, 110, 118, 97, 108, 105, 100, 32, 119, 105, 110, 100, 111, 119, 32, 115, 105, 122, 101, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str418 = allocate([ 117, 110, 107, 110, 111, 119, 110, 32, 104, 101, 97, 100, 101, 114, 32, 102, 108, 97, 103, 115, 32, 115, 101, 116, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str519 = allocate([ 104, 101, 97, 100, 101, 114, 32, 99, 114, 99, 32, 109, 105, 115, 109, 97, 116, 99, 104, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str620 = allocate([ 105, 110, 118, 97, 108, 105, 100, 32, 98, 108, 111, 99, 107, 32, 116, 121, 112, 101, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str721 = allocate([ 105, 110, 118, 97, 108, 105, 100, 32, 115, 116, 111, 114, 101, 100, 32, 98, 108, 111, 99, 107, 32, 108, 101, 110, 103, 116, 104, 115, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str822 = allocate([ 116, 111, 111, 32, 109, 97, 110, 121, 32, 108, 101, 110, 103, 116, 104, 32, 111, 114, 32, 100, 105, 115, 116, 97, 110, 99, 101, 32, 115, 121, 109, 98, 111, 108, 115, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str923 = allocate([ 105, 110, 118, 97, 108, 105, 100, 32, 99, 111, 100, 101, 32, 108, 101, 110, 103, 116, 104, 115, 32, 115, 101, 116, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str1024 = allocate([ 105, 110, 118, 97, 108, 105, 100, 32, 98, 105, 116, 32, 108, 101, 110, 103, 116, 104, 32, 114, 101, 112, 101, 97, 116, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str1125 = allocate([ 105, 110, 118, 97, 108, 105, 100, 32, 99, 111, 100, 101, 32, 45, 45, 32, 109, 105, 115, 115, 105, 110, 103, 32, 101, 110, 100, 45, 111, 102, 45, 98, 108, 111, 99, 107, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str1226 = allocate([ 105, 110, 118, 97, 108, 105, 100, 32, 108, 105, 116, 101, 114, 97, 108, 47, 108, 101, 110, 103, 116, 104, 115, 32, 115, 101, 116, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str1327 = allocate([ 105, 110, 118, 97, 108, 105, 100, 32, 100, 105, 115, 116, 97, 110, 99, 101, 115, 32, 115, 101, 116, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str17 = allocate([ 105, 110, 99, 111, 114, 114, 101, 99, 116, 32, 100, 97, 116, 97, 32, 99, 104, 101, 99, 107, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str18 = allocate([ 105, 110, 99, 111, 114, 114, 101, 99, 116, 32, 108, 101, 110, 103, 116, 104, 32, 99, 104, 101, 99, 107, 0 ], "i8", ALLOC_STATIC);

_fixedtables_lenfix = allocate([ 96, 7, 0, 0, 0, 8, 80, 0, 0, 8, 16, 0, 20, 8, 115, 0, 18, 7, 31, 0, 0, 8, 112, 0, 0, 8, 48, 0, 0, 9, 192, 0, 16, 7, 10, 0, 0, 8, 96, 0, 0, 8, 32, 0, 0, 9, 160, 0, 0, 8, 0, 0, 0, 8, 128, 0, 0, 8, 64, 0, 0, 9, 224, 0, 16, 7, 6, 0, 0, 8, 88, 0, 0, 8, 24, 0, 0, 9, 144, 0, 19, 7, 59, 0, 0, 8, 120, 0, 0, 8, 56, 0, 0, 9, 208, 0, 17, 7, 17, 0, 0, 8, 104, 0, 0, 8, 40, 0, 0, 9, 176, 0, 0, 8, 8, 0, 0, 8, 136, 0, 0, 8, 72, 0, 0, 9, 240, 0, 16, 7, 4, 0, 0, 8, 84, 0, 0, 8, 20, 0, 21, 8, 227, 0, 19, 7, 43, 0, 0, 8, 116, 0, 0, 8, 52, 0, 0, 9, 200, 0, 17, 7, 13, 0, 0, 8, 100, 0, 0, 8, 36, 0, 0, 9, 168, 0, 0, 8, 4, 0, 0, 8, 132, 0, 0, 8, 68, 0, 0, 9, 232, 0, 16, 7, 8, 0, 0, 8, 92, 0, 0, 8, 28, 0, 0, 9, 152, 0, 20, 7, 83, 0, 0, 8, 124, 0, 0, 8, 60, 0, 0, 9, 216, 0, 18, 7, 23, 0, 0, 8, 108, 0, 0, 8, 44, 0, 0, 9, 184, 0, 0, 8, 12, 0, 0, 8, 140, 0, 0, 8, 76, 0, 0, 9, 248, 0, 16, 7, 3, 0, 0, 8, 82, 0, 0, 8, 18, 0, 21, 8, 163, 0, 19, 7, 35, 0, 0, 8, 114, 0, 0, 8, 50, 0, 0, 9, 196, 0, 17, 7, 11, 0, 0, 8, 98, 0, 0, 8, 34, 0, 0, 9, 164, 0, 0, 8, 2, 0, 0, 8, 130, 0, 0, 8, 66, 0, 0, 9, 228, 0, 16, 7, 7, 0, 0, 8, 90, 0, 0, 8, 26, 0, 0, 9, 148, 0, 20, 7, 67, 0, 0, 8, 122, 0, 0, 8, 58, 0, 0, 9, 212, 0, 18, 7, 19, 0, 0, 8, 106, 0, 0, 8, 42, 0, 0, 9, 180, 0, 0, 8, 10, 0, 0, 8, 138, 0, 0, 8, 74, 0, 0, 9, 244, 0, 16, 7, 5, 0, 0, 8, 86, 0, 0, 8, 22, 0, 64, 8, 0, 0, 19, 7, 51, 0, 0, 8, 118, 0, 0, 8, 54, 0, 0, 9, 204, 0, 17, 7, 15, 0, 0, 8, 102, 0, 0, 8, 38, 0, 0, 9, 172, 0, 0, 8, 6, 0, 0, 8, 134, 0, 0, 8, 70, 0, 0, 9, 236, 0, 16, 7, 9, 0, 0, 8, 94, 0, 0, 8, 30, 0, 0, 9, 156, 0, 20, 7, 99, 0, 0, 8, 126, 0, 0, 8, 62, 0, 0, 9, 220, 0, 18, 7, 27, 0, 0, 8, 110, 0, 0, 8, 46, 0, 0, 9, 188, 0, 0, 8, 14, 0, 0, 8, 142, 0, 0, 8, 78, 0, 0, 9, 252, 0, 96, 7, 0, 0, 0, 8, 81, 0, 0, 8, 17, 0, 21, 8, 131, 0, 18, 7, 31, 0, 0, 8, 113, 0, 0, 8, 49, 0, 0, 9, 194, 0, 16, 7, 10, 0, 0, 8, 97, 0, 0, 8, 33, 0, 0, 9, 162, 0, 0, 8, 1, 0, 0, 8, 129, 0, 0, 8, 65, 0, 0, 9, 226, 0, 16, 7, 6, 0, 0, 8, 89, 0, 0, 8, 25, 0, 0, 9, 146, 0, 19, 7, 59, 0, 0, 8, 121, 0, 0, 8, 57, 0, 0, 9, 210, 0, 17, 7, 17, 0, 0, 8, 105, 0, 0, 8, 41, 0, 0, 9, 178, 0, 0, 8, 9, 0, 0, 8, 137, 0, 0, 8, 73, 0, 0, 9, 242, 0, 16, 7, 4, 0, 0, 8, 85, 0, 0, 8, 21, 0, 16, 8, 258, 0, 19, 7, 43, 0, 0, 8, 117, 0, 0, 8, 53, 0, 0, 9, 202, 0, 17, 7, 13, 0, 0, 8, 101, 0, 0, 8, 37, 0, 0, 9, 170, 0, 0, 8, 5, 0, 0, 8, 133, 0, 0, 8, 69, 0, 0, 9, 234, 0, 16, 7, 8, 0, 0, 8, 93, 0, 0, 8, 29, 0, 0, 9, 154, 0, 20, 7, 83, 0, 0, 8, 125, 0, 0, 8, 61, 0, 0, 9, 218, 0, 18, 7, 23, 0, 0, 8, 109, 0, 0, 8, 45, 0, 0, 9, 186, 0, 0, 8, 13, 0, 0, 8, 141, 0, 0, 8, 77, 0, 0, 9, 250, 0, 16, 7, 3, 0, 0, 8, 83, 0, 0, 8, 19, 0, 21, 8, 195, 0, 19, 7, 35, 0, 0, 8, 115, 0, 0, 8, 51, 0, 0, 9, 198, 0, 17, 7, 11, 0, 0, 8, 99, 0, 0, 8, 35, 0, 0, 9, 166, 0, 0, 8, 3, 0, 0, 8, 131, 0, 0, 8, 67, 0, 0, 9, 230, 0, 16, 7, 7, 0, 0, 8, 91, 0, 0, 8, 27, 0, 0, 9, 150, 0, 20, 7, 67, 0, 0, 8, 123, 0, 0, 8, 59, 0, 0, 9, 214, 0, 18, 7, 19, 0, 0, 8, 107, 0, 0, 8, 43, 0, 0, 9, 182, 0, 0, 8, 11, 0, 0, 8, 139, 0, 0, 8, 75, 0, 0, 9, 246, 0, 16, 7, 5, 0, 0, 8, 87, 0, 0, 8, 23, 0, 64, 8, 0, 0, 19, 7, 51, 0, 0, 8, 119, 0, 0, 8, 55, 0, 0, 9, 206, 0, 17, 7, 15, 0, 0, 8, 103, 0, 0, 8, 39, 0, 0, 9, 174, 0, 0, 8, 7, 0, 0, 8, 135, 0, 0, 8, 71, 0, 0, 9, 238, 0, 16, 7, 9, 0, 0, 8, 95, 0, 0, 8, 31, 0, 0, 9, 158, 0, 20, 7, 99, 0, 0, 8, 127, 0, 0, 8, 63, 0, 0, 9, 222, 0, 18, 7, 27, 0, 0, 8, 111, 0, 0, 8, 47, 0, 0, 9, 190, 0, 0, 8, 15, 0, 0, 8, 143, 0, 0, 8, 79, 0, 0, 9, 254, 0, 96, 7, 0, 0, 0, 8, 80, 0, 0, 8, 16, 0, 20, 8, 115, 0, 18, 7, 31, 0, 0, 8, 112, 0, 0, 8, 48, 0, 0, 9, 193, 0, 16, 7, 10, 0, 0, 8, 96, 0, 0, 8, 32, 0, 0, 9, 161, 0, 0, 8, 0, 0, 0, 8, 128, 0, 0, 8, 64, 0, 0, 9, 225, 0, 16, 7, 6, 0, 0, 8, 88, 0, 0, 8, 24, 0, 0, 9, 145, 0, 19, 7, 59, 0, 0, 8, 120, 0, 0, 8, 56, 0, 0, 9, 209, 0, 17, 7, 17, 0, 0, 8, 104, 0, 0, 8, 40, 0, 0, 9, 177, 0, 0, 8, 8, 0, 0, 8, 136, 0, 0, 8, 72, 0, 0, 9, 241, 0, 16, 7, 4, 0, 0, 8, 84, 0, 0, 8, 20, 0, 21, 8, 227, 0, 19, 7, 43, 0, 0, 8, 116, 0, 0, 8, 52, 0, 0, 9, 201, 0, 17, 7, 13, 0, 0, 8, 100, 0, 0, 8, 36, 0, 0, 9, 169, 0, 0, 8, 4, 0, 0, 8, 132, 0, 0, 8, 68, 0, 0, 9, 233, 0, 16, 7, 8, 0, 0, 8, 92, 0, 0, 8, 28, 0, 0, 9, 153, 0, 20, 7, 83, 0, 0, 8, 124, 0, 0, 8, 60, 0, 0, 9, 217, 0, 18, 7, 23, 0, 0, 8, 108, 0, 0, 8, 44, 0, 0, 9, 185, 0, 0, 8, 12, 0, 0, 8, 140, 0, 0, 8, 76, 0, 0, 9, 249, 0, 16, 7, 3, 0, 0, 8, 82, 0, 0, 8, 18, 0, 21, 8, 163, 0, 19, 7, 35, 0, 0, 8, 114, 0, 0, 8, 50, 0, 0, 9, 197, 0, 17, 7, 11, 0, 0, 8, 98, 0, 0, 8, 34, 0, 0, 9, 165, 0, 0, 8, 2, 0, 0, 8, 130, 0, 0, 8, 66, 0, 0, 9, 229, 0, 16, 7, 7, 0, 0, 8, 90, 0, 0, 8, 26, 0, 0, 9, 149, 0, 20, 7, 67, 0, 0, 8, 122, 0, 0, 8, 58, 0, 0, 9, 213, 0, 18, 7, 19, 0, 0, 8, 106, 0, 0, 8, 42, 0, 0, 9, 181, 0, 0, 8, 10, 0, 0, 8, 138, 0, 0, 8, 74, 0, 0, 9, 245, 0, 16, 7, 5, 0, 0, 8, 86, 0, 0, 8, 22, 0, 64, 8, 0, 0, 19, 7, 51, 0, 0, 8, 118, 0, 0, 8, 54, 0, 0, 9, 205, 0, 17, 7, 15, 0, 0, 8, 102, 0, 0, 8, 38, 0, 0, 9, 173, 0, 0, 8, 6, 0, 0, 8, 134, 0, 0, 8, 70, 0, 0, 9, 237, 0, 16, 7, 9, 0, 0, 8, 94, 0, 0, 8, 30, 0, 0, 9, 157, 0, 20, 7, 99, 0, 0, 8, 126, 0, 0, 8, 62, 0, 0, 9, 221, 0, 18, 7, 27, 0, 0, 8, 110, 0, 0, 8, 46, 0, 0, 9, 189, 0, 0, 8, 14, 0, 0, 8, 142, 0, 0, 8, 78, 0, 0, 9, 253, 0, 96, 7, 0, 0, 0, 8, 81, 0, 0, 8, 17, 0, 21, 8, 131, 0, 18, 7, 31, 0, 0, 8, 113, 0, 0, 8, 49, 0, 0, 9, 195, 0, 16, 7, 10, 0, 0, 8, 97, 0, 0, 8, 33, 0, 0, 9, 163, 0, 0, 8, 1, 0, 0, 8, 129, 0, 0, 8, 65, 0, 0, 9, 227, 0, 16, 7, 6, 0, 0, 8, 89, 0, 0, 8, 25, 0, 0, 9, 147, 0, 19, 7, 59, 0, 0, 8, 121, 0, 0, 8, 57, 0, 0, 9, 211, 0, 17, 7, 17, 0, 0, 8, 105, 0, 0, 8, 41, 0, 0, 9, 179, 0, 0, 8, 9, 0, 0, 8, 137, 0, 0, 8, 73, 0, 0, 9, 243, 0, 16, 7, 4, 0, 0, 8, 85, 0, 0, 8, 21, 0, 16, 8, 258, 0, 19, 7, 43, 0, 0, 8, 117, 0, 0, 8, 53, 0, 0, 9, 203, 0, 17, 7, 13, 0, 0, 8, 101, 0, 0, 8, 37, 0, 0, 9, 171, 0, 0, 8, 5, 0, 0, 8, 133, 0, 0, 8, 69, 0, 0, 9, 235, 0, 16, 7, 8, 0, 0, 8, 93, 0, 0, 8, 29, 0, 0, 9, 155, 0, 20, 7, 83, 0, 0, 8, 125, 0, 0, 8, 61, 0, 0, 9, 219, 0, 18, 7, 23, 0, 0, 8, 109, 0, 0, 8, 45, 0, 0, 9, 187, 0, 0, 8, 13, 0, 0, 8, 141, 0, 0, 8, 77, 0, 0, 9, 251, 0, 16, 7, 3, 0, 0, 8, 83, 0, 0, 8, 19, 0, 21, 8, 195, 0, 19, 7, 35, 0, 0, 8, 115, 0, 0, 8, 51, 0, 0, 9, 199, 0, 17, 7, 11, 0, 0, 8, 99, 0, 0, 8, 35, 0, 0, 9, 167, 0, 0, 8, 3, 0, 0, 8, 131, 0, 0, 8, 67, 0, 0, 9, 231, 0, 16, 7, 7, 0, 0, 8, 91, 0, 0, 8, 27, 0, 0, 9, 151, 0, 20, 7, 67, 0, 0, 8, 123, 0, 0, 8, 59, 0, 0, 9, 215, 0, 18, 7, 19, 0, 0, 8, 107, 0, 0, 8, 43, 0, 0, 9, 183, 0, 0, 8, 11, 0, 0, 8, 139, 0, 0, 8, 75, 0, 0, 9, 247, 0, 16, 7, 5, 0, 0, 8, 87, 0, 0, 8, 23, 0, 64, 8, 0, 0, 19, 7, 51, 0, 0, 8, 119, 0, 0, 8, 55, 0, 0, 9, 207, 0, 17, 7, 15, 0, 0, 8, 103, 0, 0, 8, 39, 0, 0, 9, 175, 0, 0, 8, 7, 0, 0, 8, 135, 0, 0, 8, 71, 0, 0, 9, 239, 0, 16, 7, 9, 0, 0, 8, 95, 0, 0, 8, 31, 0, 0, 9, 159, 0, 20, 7, 99, 0, 0, 8, 127, 0, 0, 8, 63, 0, 0, 9, 223, 0, 18, 7, 27, 0, 0, 8, 111, 0, 0, 8, 47, 0, 0, 9, 191, 0, 0, 8, 15, 0, 0, 8, 143, 0, 0, 8, 79, 0, 0, 9, 255, 0 ], [ "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0 ], ALLOC_STATIC);

_fixedtables_distfix = allocate([ 16, 5, 1, 0, 23, 5, 257, 0, 19, 5, 17, 0, 27, 5, 4097, 0, 17, 5, 5, 0, 25, 5, 1025, 0, 21, 5, 65, 0, 29, 5, 16385, 0, 16, 5, 3, 0, 24, 5, 513, 0, 20, 5, 33, 0, 28, 5, 8193, 0, 18, 5, 9, 0, 26, 5, 2049, 0, 22, 5, 129, 0, 64, 5, 0, 0, 16, 5, 2, 0, 23, 5, 385, 0, 19, 5, 25, 0, 27, 5, 6145, 0, 17, 5, 7, 0, 25, 5, 1537, 0, 21, 5, 97, 0, 29, 5, 24577, 0, 16, 5, 4, 0, 24, 5, 769, 0, 20, 5, 49, 0, 28, 5, 12289, 0, 18, 5, 13, 0, 26, 5, 3073, 0, 22, 5, 193, 0, 64, 5, 0, 0 ], [ "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0, "i8", "i8", "i16", 0 ], ALLOC_STATIC);

STRING_TABLE.__dist_code = allocate([ 0, 1, 2, 3, 4, 4, 5, 5, 6, 6, 6, 6, 7, 7, 7, 7, 8, 8, 8, 8, 8, 8, 8, 8, 9, 9, 9, 9, 9, 9, 9, 9, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 11, 11, 11, 11, 11, 11, 11, 11, 11, 11, 11, 11, 11, 11, 11, 11, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 13, 13, 13, 13, 13, 13, 13, 13, 13, 13, 13, 13, 13, 13, 13, 13, 13, 13, 13, 13, 13, 13, 13, 13, 13, 13, 13, 13, 13, 13, 13, 13, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 0, 0, 16, 17, 18, 18, 19, 19, 20, 20, 20, 20, 21, 21, 21, 21, 22, 22, 22, 22, 22, 22, 22, 22, 23, 23, 23, 23, 23, 23, 23, 23, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 26, 26, 26, 26, 26, 26, 26, 26, 26, 26, 26, 26, 26, 26, 26, 26, 26, 26, 26, 26, 26, 26, 26, 26, 26, 26, 26, 26, 26, 26, 26, 26, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 29, 29, 29, 29, 29, 29, 29, 29, 29, 29, 29, 29, 29, 29, 29, 29, 29, 29, 29, 29, 29, 29, 29, 29, 29, 29, 29, 29, 29, 29, 29, 29, 29, 29, 29, 29, 29, 29, 29, 29, 29, 29, 29, 29, 29, 29, 29, 29, 29, 29, 29, 29, 29, 29, 29, 29, 29, 29, 29, 29, 29, 29, 29, 29 ], "i8", ALLOC_STATIC);

STRING_TABLE.__length_code = allocate([ 0, 1, 2, 3, 4, 5, 6, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 12, 12, 13, 13, 13, 13, 14, 14, 14, 14, 15, 15, 15, 15, 16, 16, 16, 16, 16, 16, 16, 16, 17, 17, 17, 17, 17, 17, 17, 17, 18, 18, 18, 18, 18, 18, 18, 18, 19, 19, 19, 19, 19, 19, 19, 19, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 21, 21, 21, 21, 21, 21, 21, 21, 21, 21, 21, 21, 21, 21, 21, 21, 22, 22, 22, 22, 22, 22, 22, 22, 22, 22, 22, 22, 22, 22, 22, 22, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 26, 26, 26, 26, 26, 26, 26, 26, 26, 26, 26, 26, 26, 26, 26, 26, 26, 26, 26, 26, 26, 26, 26, 26, 26, 26, 26, 26, 26, 26, 26, 26, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 28 ], "i8", ALLOC_STATIC);

_static_l_desc = allocate([ 0, 0, 0, 0, 0, 0, 0, 0, 257, 0, 0, 0, 286, 0, 0, 0, 15, 0, 0, 0 ], [ "*", 0, 0, 0, "*", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0 ], ALLOC_STATIC);

_static_d_desc = allocate([ 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 30, 0, 0, 0, 15, 0, 0, 0 ], [ "*", 0, 0, 0, "*", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0 ], ALLOC_STATIC);

_static_bl_desc = allocate([ 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 19, 0, 0, 0, 7, 0, 0, 0 ], [ "*", 0, 0, 0, "*", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0 ], ALLOC_STATIC);

_static_ltree = allocate([ 12, 0, 8, 0, 140, 0, 8, 0, 76, 0, 8, 0, 204, 0, 8, 0, 44, 0, 8, 0, 172, 0, 8, 0, 108, 0, 8, 0, 236, 0, 8, 0, 28, 0, 8, 0, 156, 0, 8, 0, 92, 0, 8, 0, 220, 0, 8, 0, 60, 0, 8, 0, 188, 0, 8, 0, 124, 0, 8, 0, 252, 0, 8, 0, 2, 0, 8, 0, 130, 0, 8, 0, 66, 0, 8, 0, 194, 0, 8, 0, 34, 0, 8, 0, 162, 0, 8, 0, 98, 0, 8, 0, 226, 0, 8, 0, 18, 0, 8, 0, 146, 0, 8, 0, 82, 0, 8, 0, 210, 0, 8, 0, 50, 0, 8, 0, 178, 0, 8, 0, 114, 0, 8, 0, 242, 0, 8, 0, 10, 0, 8, 0, 138, 0, 8, 0, 74, 0, 8, 0, 202, 0, 8, 0, 42, 0, 8, 0, 170, 0, 8, 0, 106, 0, 8, 0, 234, 0, 8, 0, 26, 0, 8, 0, 154, 0, 8, 0, 90, 0, 8, 0, 218, 0, 8, 0, 58, 0, 8, 0, 186, 0, 8, 0, 122, 0, 8, 0, 250, 0, 8, 0, 6, 0, 8, 0, 134, 0, 8, 0, 70, 0, 8, 0, 198, 0, 8, 0, 38, 0, 8, 0, 166, 0, 8, 0, 102, 0, 8, 0, 230, 0, 8, 0, 22, 0, 8, 0, 150, 0, 8, 0, 86, 0, 8, 0, 214, 0, 8, 0, 54, 0, 8, 0, 182, 0, 8, 0, 118, 0, 8, 0, 246, 0, 8, 0, 14, 0, 8, 0, 142, 0, 8, 0, 78, 0, 8, 0, 206, 0, 8, 0, 46, 0, 8, 0, 174, 0, 8, 0, 110, 0, 8, 0, 238, 0, 8, 0, 30, 0, 8, 0, 158, 0, 8, 0, 94, 0, 8, 0, 222, 0, 8, 0, 62, 0, 8, 0, 190, 0, 8, 0, 126, 0, 8, 0, 254, 0, 8, 0, 1, 0, 8, 0, 129, 0, 8, 0, 65, 0, 8, 0, 193, 0, 8, 0, 33, 0, 8, 0, 161, 0, 8, 0, 97, 0, 8, 0, 225, 0, 8, 0, 17, 0, 8, 0, 145, 0, 8, 0, 81, 0, 8, 0, 209, 0, 8, 0, 49, 0, 8, 0, 177, 0, 8, 0, 113, 0, 8, 0, 241, 0, 8, 0, 9, 0, 8, 0, 137, 0, 8, 0, 73, 0, 8, 0, 201, 0, 8, 0, 41, 0, 8, 0, 169, 0, 8, 0, 105, 0, 8, 0, 233, 0, 8, 0, 25, 0, 8, 0, 153, 0, 8, 0, 89, 0, 8, 0, 217, 0, 8, 0, 57, 0, 8, 0, 185, 0, 8, 0, 121, 0, 8, 0, 249, 0, 8, 0, 5, 0, 8, 0, 133, 0, 8, 0, 69, 0, 8, 0, 197, 0, 8, 0, 37, 0, 8, 0, 165, 0, 8, 0, 101, 0, 8, 0, 229, 0, 8, 0, 21, 0, 8, 0, 149, 0, 8, 0, 85, 0, 8, 0, 213, 0, 8, 0, 53, 0, 8, 0, 181, 0, 8, 0, 117, 0, 8, 0, 245, 0, 8, 0, 13, 0, 8, 0, 141, 0, 8, 0, 77, 0, 8, 0, 205, 0, 8, 0, 45, 0, 8, 0, 173, 0, 8, 0, 109, 0, 8, 0, 237, 0, 8, 0, 29, 0, 8, 0, 157, 0, 8, 0, 93, 0, 8, 0, 221, 0, 8, 0, 61, 0, 8, 0, 189, 0, 8, 0, 125, 0, 8, 0, 253, 0, 8, 0, 19, 0, 9, 0, 275, 0, 9, 0, 147, 0, 9, 0, 403, 0, 9, 0, 83, 0, 9, 0, 339, 0, 9, 0, 211, 0, 9, 0, 467, 0, 9, 0, 51, 0, 9, 0, 307, 0, 9, 0, 179, 0, 9, 0, 435, 0, 9, 0, 115, 0, 9, 0, 371, 0, 9, 0, 243, 0, 9, 0, 499, 0, 9, 0, 11, 0, 9, 0, 267, 0, 9, 0, 139, 0, 9, 0, 395, 0, 9, 0, 75, 0, 9, 0, 331, 0, 9, 0, 203, 0, 9, 0, 459, 0, 9, 0, 43, 0, 9, 0, 299, 0, 9, 0, 171, 0, 9, 0, 427, 0, 9, 0, 107, 0, 9, 0, 363, 0, 9, 0, 235, 0, 9, 0, 491, 0, 9, 0, 27, 0, 9, 0, 283, 0, 9, 0, 155, 0, 9, 0, 411, 0, 9, 0, 91, 0, 9, 0, 347, 0, 9, 0, 219, 0, 9, 0, 475, 0, 9, 0, 59, 0, 9, 0, 315, 0, 9, 0, 187, 0, 9, 0, 443, 0, 9, 0, 123, 0, 9, 0, 379, 0, 9, 0, 251, 0, 9, 0, 507, 0, 9, 0, 7, 0, 9, 0, 263, 0, 9, 0, 135, 0, 9, 0, 391, 0, 9, 0, 71, 0, 9, 0, 327, 0, 9, 0, 199, 0, 9, 0, 455, 0, 9, 0, 39, 0, 9, 0, 295, 0, 9, 0, 167, 0, 9, 0, 423, 0, 9, 0, 103, 0, 9, 0, 359, 0, 9, 0, 231, 0, 9, 0, 487, 0, 9, 0, 23, 0, 9, 0, 279, 0, 9, 0, 151, 0, 9, 0, 407, 0, 9, 0, 87, 0, 9, 0, 343, 0, 9, 0, 215, 0, 9, 0, 471, 0, 9, 0, 55, 0, 9, 0, 311, 0, 9, 0, 183, 0, 9, 0, 439, 0, 9, 0, 119, 0, 9, 0, 375, 0, 9, 0, 247, 0, 9, 0, 503, 0, 9, 0, 15, 0, 9, 0, 271, 0, 9, 0, 143, 0, 9, 0, 399, 0, 9, 0, 79, 0, 9, 0, 335, 0, 9, 0, 207, 0, 9, 0, 463, 0, 9, 0, 47, 0, 9, 0, 303, 0, 9, 0, 175, 0, 9, 0, 431, 0, 9, 0, 111, 0, 9, 0, 367, 0, 9, 0, 239, 0, 9, 0, 495, 0, 9, 0, 31, 0, 9, 0, 287, 0, 9, 0, 159, 0, 9, 0, 415, 0, 9, 0, 95, 0, 9, 0, 351, 0, 9, 0, 223, 0, 9, 0, 479, 0, 9, 0, 63, 0, 9, 0, 319, 0, 9, 0, 191, 0, 9, 0, 447, 0, 9, 0, 127, 0, 9, 0, 383, 0, 9, 0, 255, 0, 9, 0, 511, 0, 9, 0, 0, 0, 7, 0, 64, 0, 7, 0, 32, 0, 7, 0, 96, 0, 7, 0, 16, 0, 7, 0, 80, 0, 7, 0, 48, 0, 7, 0, 112, 0, 7, 0, 8, 0, 7, 0, 72, 0, 7, 0, 40, 0, 7, 0, 104, 0, 7, 0, 24, 0, 7, 0, 88, 0, 7, 0, 56, 0, 7, 0, 120, 0, 7, 0, 4, 0, 7, 0, 68, 0, 7, 0, 36, 0, 7, 0, 100, 0, 7, 0, 20, 0, 7, 0, 84, 0, 7, 0, 52, 0, 7, 0, 116, 0, 7, 0, 3, 0, 8, 0, 131, 0, 8, 0, 67, 0, 8, 0, 195, 0, 8, 0, 35, 0, 8, 0, 163, 0, 8, 0, 99, 0, 8, 0, 227, 0, 8, 0 ], [ "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0 ], ALLOC_STATIC);

_static_dtree = allocate([ 0, 0, 5, 0, 16, 0, 5, 0, 8, 0, 5, 0, 24, 0, 5, 0, 4, 0, 5, 0, 20, 0, 5, 0, 12, 0, 5, 0, 28, 0, 5, 0, 2, 0, 5, 0, 18, 0, 5, 0, 10, 0, 5, 0, 26, 0, 5, 0, 6, 0, 5, 0, 22, 0, 5, 0, 14, 0, 5, 0, 30, 0, 5, 0, 1, 0, 5, 0, 17, 0, 5, 0, 9, 0, 5, 0, 25, 0, 5, 0, 5, 0, 5, 0, 21, 0, 5, 0, 13, 0, 5, 0, 29, 0, 5, 0, 3, 0, 5, 0, 19, 0, 5, 0, 11, 0, 5, 0, 27, 0, 5, 0, 7, 0, 5, 0, 23, 0, 5, 0 ], [ "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0 ], ALLOC_STATIC);

_extra_lbits = allocate([ 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0, 3, 0, 0, 0, 3, 0, 0, 0, 3, 0, 0, 0, 4, 0, 0, 0, 4, 0, 0, 0, 4, 0, 0, 0, 4, 0, 0, 0, 5, 0, 0, 0, 5, 0, 0, 0, 5, 0, 0, 0, 5, 0, 0, 0, 0, 0, 0, 0 ], [ "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0 ], ALLOC_STATIC);

_base_length = allocate([ 0, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0, 4, 0, 0, 0, 5, 0, 0, 0, 6, 0, 0, 0, 7, 0, 0, 0, 8, 0, 0, 0, 10, 0, 0, 0, 12, 0, 0, 0, 14, 0, 0, 0, 16, 0, 0, 0, 20, 0, 0, 0, 24, 0, 0, 0, 28, 0, 0, 0, 32, 0, 0, 0, 40, 0, 0, 0, 48, 0, 0, 0, 56, 0, 0, 0, 64, 0, 0, 0, 80, 0, 0, 0, 96, 0, 0, 0, 112, 0, 0, 0, 128, 0, 0, 0, 160, 0, 0, 0, 192, 0, 0, 0, 224, 0, 0, 0, 0, 0, 0, 0 ], [ "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0 ], ALLOC_STATIC);

_extra_dbits = allocate([ 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0, 3, 0, 0, 0, 4, 0, 0, 0, 4, 0, 0, 0, 5, 0, 0, 0, 5, 0, 0, 0, 6, 0, 0, 0, 6, 0, 0, 0, 7, 0, 0, 0, 7, 0, 0, 0, 8, 0, 0, 0, 8, 0, 0, 0, 9, 0, 0, 0, 9, 0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 11, 0, 0, 0, 11, 0, 0, 0, 12, 0, 0, 0, 12, 0, 0, 0, 13, 0, 0, 0, 13, 0, 0, 0 ], [ "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0 ], ALLOC_STATIC);

_base_dist = allocate([ 0, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0, 4, 0, 0, 0, 6, 0, 0, 0, 8, 0, 0, 0, 12, 0, 0, 0, 16, 0, 0, 0, 24, 0, 0, 0, 32, 0, 0, 0, 48, 0, 0, 0, 64, 0, 0, 0, 96, 0, 0, 0, 128, 0, 0, 0, 192, 0, 0, 0, 256, 0, 0, 0, 384, 0, 0, 0, 512, 0, 0, 0, 768, 0, 0, 0, 1024, 0, 0, 0, 1536, 0, 0, 0, 2048, 0, 0, 0, 3072, 0, 0, 0, 4096, 0, 0, 0, 6144, 0, 0, 0, 8192, 0, 0, 0, 12288, 0, 0, 0, 16384, 0, 0, 0, 24576, 0, 0, 0 ], [ "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0 ], ALLOC_STATIC);

STRING_TABLE._bl_order = allocate([ 16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15 ], "i8", ALLOC_STATIC);

_extra_blbits = allocate([ 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0, 7, 0, 0, 0 ], [ "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0 ], ALLOC_STATIC);

_crc_table = allocate([ 0, 0, 0, 0, 1996959894, 0, 0, 0, -301047508, 0, 0, 0, -1727442502, 0, 0, 0, 124634137, 0, 0, 0, 1886057615, 0, 0, 0, -379345611, 0, 0, 0, -1637575261, 0, 0, 0, 249268274, 0, 0, 0, 2044508324, 0, 0, 0, -522852066, 0, 0, 0, -1747789432, 0, 0, 0, 162941995, 0, 0, 0, 2125561021, 0, 0, 0, -407360249, 0, 0, 0, -1866523247, 0, 0, 0, 498536548, 0, 0, 0, 1789927666, 0, 0, 0, -205950648, 0, 0, 0, -2067906082, 0, 0, 0, 450548861, 0, 0, 0, 1843258603, 0, 0, 0, -187386543, 0, 0, 0, -2083289657, 0, 0, 0, 325883990, 0, 0, 0, 1684777152, 0, 0, 0, -43845254, 0, 0, 0, -1973040660, 0, 0, 0, 335633487, 0, 0, 0, 1661365465, 0, 0, 0, -99664541, 0, 0, 0, -1928851979, 0, 0, 0, 997073096, 0, 0, 0, 1281953886, 0, 0, 0, -715111964, 0, 0, 0, -1570279054, 0, 0, 0, 1006888145, 0, 0, 0, 1258607687, 0, 0, 0, -770865667, 0, 0, 0, -1526024853, 0, 0, 0, 901097722, 0, 0, 0, 1119000684, 0, 0, 0, -608450090, 0, 0, 0, -1396901568, 0, 0, 0, 853044451, 0, 0, 0, 1172266101, 0, 0, 0, -589951537, 0, 0, 0, -1412350631, 0, 0, 0, 651767980, 0, 0, 0, 1373503546, 0, 0, 0, -925412992, 0, 0, 0, -1076862698, 0, 0, 0, 565507253, 0, 0, 0, 1454621731, 0, 0, 0, -809855591, 0, 0, 0, -1195530993, 0, 0, 0, 671266974, 0, 0, 0, 1594198024, 0, 0, 0, -972236366, 0, 0, 0, -1324619484, 0, 0, 0, 795835527, 0, 0, 0, 1483230225, 0, 0, 0, -1050600021, 0, 0, 0, -1234817731, 0, 0, 0, 1994146192, 0, 0, 0, 31158534, 0, 0, 0, -1731059524, 0, 0, 0, -271249366, 0, 0, 0, 1907459465, 0, 0, 0, 112637215, 0, 0, 0, -1614814043, 0, 0, 0, -390540237, 0, 0, 0, 2013776290, 0, 0, 0, 251722036, 0, 0, 0, -1777751922, 0, 0, 0, -519137256, 0, 0, 0, 2137656763, 0, 0, 0, 141376813, 0, 0, 0, -1855689577, 0, 0, 0, -429695999, 0, 0, 0, 1802195444, 0, 0, 0, 476864866, 0, 0, 0, -2056965928, 0, 0, 0, -228458418, 0, 0, 0, 1812370925, 0, 0, 0, 453092731, 0, 0, 0, -2113342271, 0, 0, 0, -183516073, 0, 0, 0, 1706088902, 0, 0, 0, 314042704, 0, 0, 0, -1950435094, 0, 0, 0, -54949764, 0, 0, 0, 1658658271, 0, 0, 0, 366619977, 0, 0, 0, -1932296973, 0, 0, 0, -69972891, 0, 0, 0, 1303535960, 0, 0, 0, 984961486, 0, 0, 0, -1547960204, 0, 0, 0, -725929758, 0, 0, 0, 1256170817, 0, 0, 0, 1037604311, 0, 0, 0, -1529756563, 0, 0, 0, -740887301, 0, 0, 0, 1131014506, 0, 0, 0, 879679996, 0, 0, 0, -1385723834, 0, 0, 0, -631195440, 0, 0, 0, 1141124467, 0, 0, 0, 855842277, 0, 0, 0, -1442165665, 0, 0, 0, -586318647, 0, 0, 0, 1342533948, 0, 0, 0, 654459306, 0, 0, 0, -1106571248, 0, 0, 0, -921952122, 0, 0, 0, 1466479909, 0, 0, 0, 544179635, 0, 0, 0, -1184443383, 0, 0, 0, -832445281, 0, 0, 0, 1591671054, 0, 0, 0, 702138776, 0, 0, 0, -1328506846, 0, 0, 0, -942167884, 0, 0, 0, 1504918807, 0, 0, 0, 783551873, 0, 0, 0, -1212326853, 0, 0, 0, -1061524307, 0, 0, 0, -306674912, 0, 0, 0, -1698712650, 0, 0, 0, 62317068, 0, 0, 0, 1957810842, 0, 0, 0, -355121351, 0, 0, 0, -1647151185, 0, 0, 0, 81470997, 0, 0, 0, 1943803523, 0, 0, 0, -480048366, 0, 0, 0, -1805370492, 0, 0, 0, 225274430, 0, 0, 0, 2053790376, 0, 0, 0, -468791541, 0, 0, 0, -1828061283, 0, 0, 0, 167816743, 0, 0, 0, 2097651377, 0, 0, 0, -267414716, 0, 0, 0, -2029476910, 0, 0, 0, 503444072, 0, 0, 0, 1762050814, 0, 0, 0, -144550051, 0, 0, 0, -2140837941, 0, 0, 0, 426522225, 0, 0, 0, 1852507879, 0, 0, 0, -19653770, 0, 0, 0, -1982649376, 0, 0, 0, 282753626, 0, 0, 0, 1742555852, 0, 0, 0, -105259153, 0, 0, 0, -1900089351, 0, 0, 0, 397917763, 0, 0, 0, 1622183637, 0, 0, 0, -690576408, 0, 0, 0, -1580100738, 0, 0, 0, 953729732, 0, 0, 0, 1340076626, 0, 0, 0, -776247311, 0, 0, 0, -1497606297, 0, 0, 0, 1068828381, 0, 0, 0, 1219638859, 0, 0, 0, -670225446, 0, 0, 0, -1358292148, 0, 0, 0, 906185462, 0, 0, 0, 1090812512, 0, 0, 0, -547295293, 0, 0, 0, -1469587627, 0, 0, 0, 829329135, 0, 0, 0, 1181335161, 0, 0, 0, -882789492, 0, 0, 0, -1134132454, 0, 0, 0, 628085408, 0, 0, 0, 1382605366, 0, 0, 0, -871598187, 0, 0, 0, -1156888829, 0, 0, 0, 570562233, 0, 0, 0, 1426400815, 0, 0, 0, -977650754, 0, 0, 0, -1296233688, 0, 0, 0, 733239954, 0, 0, 0, 1555261956, 0, 0, 0, -1026031705, 0, 0, 0, -1244606671, 0, 0, 0, 752459403, 0, 0, 0, 1541320221, 0, 0, 0, -1687895376, 0, 0, 0, -328994266, 0, 0, 0, 1969922972, 0, 0, 0, 40735498, 0, 0, 0, -1677130071, 0, 0, 0, -351390145, 0, 0, 0, 1913087877, 0, 0, 0, 83908371, 0, 0, 0, -1782625662, 0, 0, 0, -491226604, 0, 0, 0, 2075208622, 0, 0, 0, 213261112, 0, 0, 0, -1831694693, 0, 0, 0, -438977011, 0, 0, 0, 2094854071, 0, 0, 0, 198958881, 0, 0, 0, -2032938284, 0, 0, 0, -237706686, 0, 0, 0, 1759359992, 0, 0, 0, 534414190, 0, 0, 0, -2118248755, 0, 0, 0, -155638181, 0, 0, 0, 1873836001, 0, 0, 0, 414664567, 0, 0, 0, -2012718362, 0, 0, 0, -15766928, 0, 0, 0, 1711684554, 0, 0, 0, 285281116, 0, 0, 0, -1889165569, 0, 0, 0, -127750551, 0, 0, 0, 1634467795, 0, 0, 0, 376229701, 0, 0, 0, -1609899400, 0, 0, 0, -686959890, 0, 0, 0, 1308918612, 0, 0, 0, 956543938, 0, 0, 0, -1486412191, 0, 0, 0, -799009033, 0, 0, 0, 1231636301, 0, 0, 0, 1047427035, 0, 0, 0, -1362007478, 0, 0, 0, -640263460, 0, 0, 0, 1088359270, 0, 0, 0, 936918e3, 0, 0, 0, -1447252397, 0, 0, 0, -558129467, 0, 0, 0, 1202900863, 0, 0, 0, 817233897, 0, 0, 0, -1111625188, 0, 0, 0, -893730166, 0, 0, 0, 1404277552, 0, 0, 0, 615818150, 0, 0, 0, -1160759803, 0, 0, 0, -841546093, 0, 0, 0, 1423857449, 0, 0, 0, 601450431, 0, 0, 0, -1285129682, 0, 0, 0, -1000256840, 0, 0, 0, 1567103746, 0, 0, 0, 711928724, 0, 0, 0, -1274298825, 0, 0, 0, -1022587231, 0, 0, 0, 1510334235, 0, 0, 0, 755167117, 0, 0, 0, 0, 0, 0, 0, 421212481, 0, 0, 0, 842424962, 0, 0, 0, 724390851, 0, 0, 0, 1684849924, 0, 0, 0, 2105013317, 0, 0, 0, 1448781702, 0, 0, 0, 1329698503, 0, 0, 0, -925267448, 0, 0, 0, -775767223, 0, 0, 0, -84940662, 0, 0, 0, -470492725, 0, 0, 0, -1397403892, 0, 0, 0, -1246855603, 0, 0, 0, -1635570290, 0, 0, 0, -2020074289, 0, 0, 0, 1254232657, 0, 0, 0, 1406739216, 0, 0, 0, 2029285587, 0, 0, 0, 1643069842, 0, 0, 0, 783210325, 0, 0, 0, 934667796, 0, 0, 0, 479770071, 0, 0, 0, 92505238, 0, 0, 0, -2112120743, 0, 0, 0, -1694455528, 0, 0, 0, -1339163941, 0, 0, 0, -1456026726, 0, 0, 0, -428384931, 0, 0, 0, -9671652, 0, 0, 0, -733921313, 0, 0, 0, -849736034, 0, 0, 0, -1786501982, 0, 0, 0, -1935731229, 0, 0, 0, -1481488864, 0, 0, 0, -1096190111, 0, 0, 0, -236396122, 0, 0, 0, -386674457, 0, 0, 0, -1008827612, 0, 0, 0, -624577947, 0, 0, 0, 1566420650, 0, 0, 0, 1145479147, 0, 0, 0, 1869335592, 0, 0, 0, 1987116393, 0, 0, 0, 959540142, 0, 0, 0, 539646703, 0, 0, 0, 185010476, 0, 0, 0, 303839341, 0, 0, 0, -549046541, 0, 0, 0, -966981710, 0, 0, 0, -311405455, 0, 0, 0, -194288336, 0, 0, 0, -1154812937, 0, 0, 0, -1573797194, 0, 0, 0, -1994616459, 0, 0, 0, -1878548428, 0, 0, 0, 396344571, 0, 0, 0, 243568058, 0, 0, 0, 631889529, 0, 0, 0, 1018359608, 0, 0, 0, 1945336319, 0, 0, 0, 1793607870, 0, 0, 0, 1103436669, 0, 0, 0, 1490954812, 0, 0, 0, -260485371, 0, 0, 0, -379421116, 0, 0, 0, -1034998393, 0, 0, 0, -615244602, 0, 0, 0, -1810527743, 0, 0, 0, -1928414400, 0, 0, 0, -1507596157, 0, 0, 0, -1086793278, 0, 0, 0, 950060301, 0, 0, 0, 565965900, 0, 0, 0, 177645455, 0, 0, 0, 328046286, 0, 0, 0, 1556873225, 0, 0, 0, 1171730760, 0, 0, 0, 1861902987, 0, 0, 0, 2011255754, 0, 0, 0, -1162125996, 0, 0, 0, -1549767659, 0, 0, 0, -2004009002, 0, 0, 0, -1852436841, 0, 0, 0, -556296112, 0, 0, 0, -942888687, 0, 0, 0, -320734510, 0, 0, 0, -168113261, 0, 0, 0, 1919080284, 0, 0, 0, 1803150877, 0, 0, 0, 1079293406, 0, 0, 0, 1498383519, 0, 0, 0, 370020952, 0, 0, 0, 253043481, 0, 0, 0, 607678682, 0, 0, 0, 1025720731, 0, 0, 0, 1711106983, 0, 0, 0, 2095471334, 0, 0, 0, 1472923941, 0, 0, 0, 1322268772, 0, 0, 0, 26324643, 0, 0, 0, 411738082, 0, 0, 0, 866634785, 0, 0, 0, 717028704, 0, 0, 0, -1390091857, 0, 0, 0, -1270886162, 0, 0, 0, -1626176723, 0, 0, 0, -2046184852, 0, 0, 0, -918018901, 0, 0, 0, -799861270, 0, 0, 0, -75610583, 0, 0, 0, -496666776, 0, 0, 0, 792689142, 0, 0, 0, 908347575, 0, 0, 0, 487136116, 0, 0, 0, 68299317, 0, 0, 0, 1263779058, 0, 0, 0, 1380486579, 0, 0, 0, 2036719216, 0, 0, 0, 1618931505, 0, 0, 0, -404294658, 0, 0, 0, -16923969, 0, 0, 0, -707751556, 0, 0, 0, -859070403, 0, 0, 0, -2088093958, 0, 0, 0, -1701771333, 0, 0, 0, -1313057672, 0, 0, 0, -1465424583, 0, 0, 0, 998479947, 0, 0, 0, 580430090, 0, 0, 0, 162921161, 0, 0, 0, 279890824, 0, 0, 0, 1609522511, 0, 0, 0, 1190423566, 0, 0, 0, 1842954189, 0, 0, 0, 1958874764, 0, 0, 0, -212200893, 0, 0, 0, -364829950, 0, 0, 0, -1049857855, 0, 0, 0, -663273088, 0, 0, 0, -1758013625, 0, 0, 0, -1909594618, 0, 0, 0, -1526680123, 0, 0, 0, -1139047292, 0, 0, 0, 1900120602, 0, 0, 0, 1750776667, 0, 0, 0, 1131931800, 0, 0, 0, 1517083097, 0, 0, 0, 355290910, 0, 0, 0, 204897887, 0, 0, 0, 656092572, 0, 0, 0, 1040194781, 0, 0, 0, -1181220846, 0, 0, 0, -1602014893, 0, 0, 0, -1951505776, 0, 0, 0, -1833610287, 0, 0, 0, -571161322, 0, 0, 0, -990907305, 0, 0, 0, -272455788, 0, 0, 0, -153512235, 0, 0, 0, -1375224599, 0, 0, 0, -1222865496, 0, 0, 0, -1674453397, 0, 0, 0, -2060783830, 0, 0, 0, -898926099, 0, 0, 0, -747616084, 0, 0, 0, -128115857, 0, 0, 0, -515495378, 0, 0, 0, 1725839073, 0, 0, 0, 2143618976, 0, 0, 0, 1424512099, 0, 0, 0, 1307796770, 0, 0, 0, 45282277, 0, 0, 0, 464110244, 0, 0, 0, 813994343, 0, 0, 0, 698327078, 0, 0, 0, -456806728, 0, 0, 0, -35741703, 0, 0, 0, -688665542, 0, 0, 0, -806814341, 0, 0, 0, -2136380484, 0, 0, 0, -1716364547, 0, 0, 0, -1298200258, 0, 0, 0, -1417398145, 0, 0, 0, 740041904, 0, 0, 0, 889656817, 0, 0, 0, 506086962, 0, 0, 0, 120682355, 0, 0, 0, 1215357364, 0, 0, 0, 1366020341, 0, 0, 0, 2051441462, 0, 0, 0, 1667084919, 0, 0, 0, -872753330, 0, 0, 0, -756947441, 0, 0, 0, -104024628, 0, 0, 0, -522746739, 0, 0, 0, -1349119414, 0, 0, 0, -1232264437, 0, 0, 0, -1650429752, 0, 0, 0, -2068102775, 0, 0, 0, 52649286, 0, 0, 0, 439905287, 0, 0, 0, 823476164, 0, 0, 0, 672009861, 0, 0, 0, 1733269570, 0, 0, 0, 2119477507, 0, 0, 0, 1434057408, 0, 0, 0, 1281543041, 0, 0, 0, -2126985953, 0, 0, 0, -1742474146, 0, 0, 0, -1290885219, 0, 0, 0, -1441425700, 0, 0, 0, -447479781, 0, 0, 0, -61918886, 0, 0, 0, -681418087, 0, 0, 0, -830909480, 0, 0, 0, 1239502615, 0, 0, 0, 1358593622, 0, 0, 0, 2077699477, 0, 0, 0, 1657543892, 0, 0, 0, 764250643, 0, 0, 0, 882293586, 0, 0, 0, 532408465, 0, 0, 0, 111204816, 0, 0, 0, 1585378284, 0, 0, 0, 1197851309, 0, 0, 0, 1816695150, 0, 0, 0, 1968414767, 0, 0, 0, 974272232, 0, 0, 0, 587794345, 0, 0, 0, 136598634, 0, 0, 0, 289367339, 0, 0, 0, -1767409180, 0, 0, 0, -1883486043, 0, 0, 0, -1533994138, 0, 0, 0, -1115018713, 0, 0, 0, -221528864, 0, 0, 0, -338653791, 0, 0, 0, -1057104286, 0, 0, 0, -639176925, 0, 0, 0, 347922877, 0, 0, 0, 229101820, 0, 0, 0, 646611775, 0, 0, 0, 1066513022, 0, 0, 0, 1892689081, 0, 0, 0, 1774917112, 0, 0, 0, 1122387515, 0, 0, 0, 1543337850, 0, 0, 0, -597333067, 0, 0, 0, -981574924, 0, 0, 0, -296548041, 0, 0, 0, -146261898, 0, 0, 0, -1207325007, 0, 0, 0, -1592614928, 0, 0, 0, -1975530445, 0, 0, 0, -1826292366, 0, 0, 0, 0, 0, 0, 0, 29518391, 0, 0, 0, 59036782, 0, 0, 0, 38190681, 0, 0, 0, 118073564, 0, 0, 0, 114017003, 0, 0, 0, 76381362, 0, 0, 0, 89069189, 0, 0, 0, 236147128, 0, 0, 0, 265370511, 0, 0, 0, 228034006, 0, 0, 0, 206958561, 0, 0, 0, 152762724, 0, 0, 0, 148411219, 0, 0, 0, 178138378, 0, 0, 0, 190596925, 0, 0, 0, 472294256, 0, 0, 0, 501532999, 0, 0, 0, 530741022, 0, 0, 0, 509615401, 0, 0, 0, 456068012, 0, 0, 0, 451764635, 0, 0, 0, 413917122, 0, 0, 0, 426358261, 0, 0, 0, 305525448, 0, 0, 0, 334993663, 0, 0, 0, 296822438, 0, 0, 0, 275991697, 0, 0, 0, 356276756, 0, 0, 0, 352202787, 0, 0, 0, 381193850, 0, 0, 0, 393929805, 0, 0, 0, 944588512, 0, 0, 0, 965684439, 0, 0, 0, 1003065998, 0, 0, 0, 973863097, 0, 0, 0, 1061482044, 0, 0, 0, 1049003019, 0, 0, 0, 1019230802, 0, 0, 0, 1023561829, 0, 0, 0, 912136024, 0, 0, 0, 933002607, 0, 0, 0, 903529270, 0, 0, 0, 874031361, 0, 0, 0, 827834244, 0, 0, 0, 815125939, 0, 0, 0, 852716522, 0, 0, 0, 856752605, 0, 0, 0, 611050896, 0, 0, 0, 631869351, 0, 0, 0, 669987326, 0, 0, 0, 640506825, 0, 0, 0, 593644876, 0, 0, 0, 580921211, 0, 0, 0, 551983394, 0, 0, 0, 556069653, 0, 0, 0, 712553512, 0, 0, 0, 733666847, 0, 0, 0, 704405574, 0, 0, 0, 675154545, 0, 0, 0, 762387700, 0, 0, 0, 749958851, 0, 0, 0, 787859610, 0, 0, 0, 792175277, 0, 0, 0, 1889177024, 0, 0, 0, 1901651959, 0, 0, 0, 1931368878, 0, 0, 0, 1927033753, 0, 0, 0, 2006131996, 0, 0, 0, 1985040171, 0, 0, 0, 1947726194, 0, 0, 0, 1976933189, 0, 0, 0, 2122964088, 0, 0, 0, 2135668303, 0, 0, 0, 2098006038, 0, 0, 0, 2093965857, 0, 0, 0, 2038461604, 0, 0, 0, 2017599123, 0, 0, 0, 2047123658, 0, 0, 0, 2076625661, 0, 0, 0, 1824272048, 0, 0, 0, 1836991623, 0, 0, 0, 1866005214, 0, 0, 0, 1861914857, 0, 0, 0, 1807058540, 0, 0, 0, 1786244187, 0, 0, 0, 1748062722, 0, 0, 0, 1777547317, 0, 0, 0, 1655668488, 0, 0, 0, 1668093247, 0, 0, 0, 1630251878, 0, 0, 0, 1625932113, 0, 0, 0, 1705433044, 0, 0, 0, 1684323811, 0, 0, 0, 1713505210, 0, 0, 0, 1742760333, 0, 0, 0, 1222101792, 0, 0, 0, 1226154263, 0, 0, 0, 1263738702, 0, 0, 0, 1251046777, 0, 0, 0, 1339974652, 0, 0, 0, 1310460363, 0, 0, 0, 1281013650, 0, 0, 0, 1301863845, 0, 0, 0, 1187289752, 0, 0, 0, 1191637167, 0, 0, 0, 1161842422, 0, 0, 0, 1149379777, 0, 0, 0, 1103966788, 0, 0, 0, 1074747507, 0, 0, 0, 1112139306, 0, 0, 0, 1133218845, 0, 0, 0, 1425107024, 0, 0, 0, 1429406311, 0, 0, 0, 1467333694, 0, 0, 0, 1454888457, 0, 0, 0, 1408811148, 0, 0, 0, 1379576507, 0, 0, 0, 1350309090, 0, 0, 0, 1371438805, 0, 0, 0, 1524775400, 0, 0, 0, 1528845279, 0, 0, 0, 1499917702, 0, 0, 0, 1487177649, 0, 0, 0, 1575719220, 0, 0, 0, 1546255107, 0, 0, 0, 1584350554, 0, 0, 0, 1605185389, 0, 0, 0, -516613248, 0, 0, 0, -520654409, 0, 0, 0, -491663378, 0, 0, 0, -478960167, 0, 0, 0, -432229540, 0, 0, 0, -402728597, 0, 0, 0, -440899790, 0, 0, 0, -461763323, 0, 0, 0, -282703304, 0, 0, 0, -287039473, 0, 0, 0, -324886954, 0, 0, 0, -312413087, 0, 0, 0, -399514908, 0, 0, 0, -370308909, 0, 0, 0, -341100918, 0, 0, 0, -362193731, 0, 0, 0, -49039120, 0, 0, 0, -53357881, 0, 0, 0, -23630690, 0, 0, 0, -11204951, 0, 0, 0, -98955220, 0, 0, 0, -69699045, 0, 0, 0, -107035582, 0, 0, 0, -128143755, 0, 0, 0, -218044088, 0, 0, 0, -222133377, 0, 0, 0, -259769050, 0, 0, 0, -247048431, 0, 0, 0, -200719980, 0, 0, 0, -171234397, 0, 0, 0, -141715974, 0, 0, 0, -162529331, 0, 0, 0, -646423200, 0, 0, 0, -658884777, 0, 0, 0, -620984050, 0, 0, 0, -616635591, 0, 0, 0, -562956868, 0, 0, 0, -541876341, 0, 0, 0, -571137582, 0, 0, 0, -600355867, 0, 0, 0, -680850216, 0, 0, 0, -693541137, 0, 0, 0, -722478922, 0, 0, 0, -718425471, 0, 0, 0, -798841852, 0, 0, 0, -777990605, 0, 0, 0, -739872662, 0, 0, 0, -769385891, 0, 0, 0, -983630320, 0, 0, 0, -996371417, 0, 0, 0, -958780802, 0, 0, 0, -954711991, 0, 0, 0, -1034463540, 0, 0, 0, -1013629701, 0, 0, 0, -1043103070, 0, 0, 0, -1072568171, 0, 0, 0, -884101208, 0, 0, 0, -896547425, 0, 0, 0, -926319674, 0, 0, 0, -922021391, 0, 0, 0, -867956876, 0, 0, 0, -846828221, 0, 0, 0, -809446630, 0, 0, 0, -838682323, 0, 0, 0, -1850763712, 0, 0, 0, -1871840137, 0, 0, 0, -1842658770, 0, 0, 0, -1813436391, 0, 0, 0, -1767489892, 0, 0, 0, -1755032405, 0, 0, 0, -1792873742, 0, 0, 0, -1797226299, 0, 0, 0, -1615017992, 0, 0, 0, -1635865137, 0, 0, 0, -1674046570, 0, 0, 0, -1644529247, 0, 0, 0, -1732939996, 0, 0, 0, -1720253165, 0, 0, 0, -1691239606, 0, 0, 0, -1695297155, 0, 0, 0, -1920387792, 0, 0, 0, -1941217529, 0, 0, 0, -1911692962, 0, 0, 0, -1882223767, 0, 0, 0, -1971282452, 0, 0, 0, -1958545445, 0, 0, 0, -1996207742, 0, 0, 0, -2000280651, 0, 0, 0, -2087033720, 0, 0, 0, -2108158273, 0, 0, 0, -2145472282, 0, 0, 0, -2116232495, 0, 0, 0, -2070688684, 0, 0, 0, -2058246557, 0, 0, 0, -2028529606, 0, 0, 0, -2032831987, 0, 0, 0, -1444753248, 0, 0, 0, -1474250089, 0, 0, 0, -1436154674, 0, 0, 0, -1415287047, 0, 0, 0, -1360299908, 0, 0, 0, -1356262837, 0, 0, 0, -1385190382, 0, 0, 0, -1397897691, 0, 0, 0, -1477345e3, 0, 0, 0, -1506546897, 0, 0, 0, -1535814282, 0, 0, 0, -1514717375, 0, 0, 0, -1594349116, 0, 0, 0, -1590017037, 0, 0, 0, -1552089686, 0, 0, 0, -1564567651, 0, 0, 0, -1245416496, 0, 0, 0, -1274668569, 0, 0, 0, -1237276738, 0, 0, 0, -1216164471, 0, 0, 0, -1295131892, 0, 0, 0, -1290817221, 0, 0, 0, -1320611998, 0, 0, 0, -1333041835, 0, 0, 0, -1143528856, 0, 0, 0, -1173010337, 0, 0, 0, -1202457082, 0, 0, 0, -1181639631, 0, 0, 0, -1126266188, 0, 0, 0, -1122180989, 0, 0, 0, -1084596518, 0, 0, 0, -1097321235, 0, 0, 0, 0, 0, 0, 0, -1195612315, 0, 0, 0, -1442199413, 0, 0, 0, 313896942, 0, 0, 0, -1889364137, 0, 0, 0, 937357362, 0, 0, 0, 627793884, 0, 0, 0, -1646839623, 0, 0, 0, -978048785, 0, 0, 0, 2097696650, 0, 0, 0, 1874714724, 0, 0, 0, -687765759, 0, 0, 0, 1255587768, 0, 0, 0, -227878691, 0, 0, 0, -522225869, 0, 0, 0, 1482887254, 0, 0, 0, 1343838111, 0, 0, 0, -391827206, 0, 0, 0, -99573996, 0, 0, 0, 1118632049, 0, 0, 0, -545537848, 0, 0, 0, 1741137837, 0, 0, 0, 1970407491, 0, 0, 0, -842109146, 0, 0, 0, -1783791760, 0, 0, 0, 756094997, 0, 0, 0, 1067759611, 0, 0, 0, -2028416866, 0, 0, 0, 449832999, 0, 0, 0, -1569484990, 0, 0, 0, -1329192788, 0, 0, 0, 142231497, 0, 0, 0, -1607291074, 0, 0, 0, 412010587, 0, 0, 0, 171665333, 0, 0, 0, -1299775280, 0, 0, 0, 793786473, 0, 0, 0, -1746116852, 0, 0, 0, -2057703198, 0, 0, 0, 1038456711, 0, 0, 0, 1703315409, 0, 0, 0, -583343948, 0, 0, 0, -812691622, 0, 0, 0, 1999841343, 0, 0, 0, -354152314, 0, 0, 0, 1381529571, 0, 0, 0, 1089329165, 0, 0, 0, -128860312, 0, 0, 0, -265553759, 0, 0, 0, 1217896388, 0, 0, 0, 1512189994, 0, 0, 0, -492939441, 0, 0, 0, 2135519222, 0, 0, 0, -940242797, 0, 0, 0, -717183107, 0, 0, 0, 1845280792, 0, 0, 0, 899665998, 0, 0, 0, -1927039189, 0, 0, 0, -1617553211, 0, 0, 0, 657096608, 0, 0, 0, -1157806311, 0, 0, 0, 37822588, 0, 0, 0, 284462994, 0, 0, 0, -1471616777, 0, 0, 0, -1693165507, 0, 0, 0, 598228824, 0, 0, 0, 824021174, 0, 0, 0, -1985873965, 0, 0, 0, 343330666, 0, 0, 0, -1396004849, 0, 0, 0, -1098971167, 0, 0, 0, 113467524, 0, 0, 0, 1587572946, 0, 0, 0, -434366537, 0, 0, 0, -190203815, 0, 0, 0, 1276501820, 0, 0, 0, -775755899, 0, 0, 0, 1769898208, 0, 0, 0, 2076913422, 0, 0, 0, -1015592853, 0, 0, 0, -888336478, 0, 0, 0, 1941006535, 0, 0, 0, 1627703081, 0, 0, 0, -642211764, 0, 0, 0, 1148164341, 0, 0, 0, -53215344, 0, 0, 0, -295284610, 0, 0, 0, 1457141531, 0, 0, 0, 247015245, 0, 0, 0, -1241169880, 0, 0, 0, -1531908154, 0, 0, 0, 470583459, 0, 0, 0, -2116308966, 0, 0, 0, 963106687, 0, 0, 0, 735213713, 0, 0, 0, -1821499404, 0, 0, 0, 992409347, 0, 0, 0, -2087022490, 0, 0, 0, -1859174520, 0, 0, 0, 697522413, 0, 0, 0, -1270587308, 0, 0, 0, 217581361, 0, 0, 0, 508405983, 0, 0, 0, -1494102086, 0, 0, 0, -23928852, 0, 0, 0, 1177467017, 0, 0, 0, 1419450215, 0, 0, 0, -332959742, 0, 0, 0, 1911572667, 0, 0, 0, -917753890, 0, 0, 0, -604405712, 0, 0, 0, 1665525589, 0, 0, 0, 1799331996, 0, 0, 0, -746338311, 0, 0, 0, -1053399017, 0, 0, 0, 2039091058, 0, 0, 0, -463652917, 0, 0, 0, 1558270126, 0, 0, 0, 1314193216, 0, 0, 0, -152528859, 0, 0, 0, -1366587277, 0, 0, 0, 372764438, 0, 0, 0, 75645176, 0, 0, 0, -1136777315, 0, 0, 0, 568925988, 0, 0, 0, -1722451903, 0, 0, 0, -1948198993, 0, 0, 0, 861712586, 0, 0, 0, -312887749, 0, 0, 0, 1441124702, 0, 0, 0, 1196457648, 0, 0, 0, -1304107, 0, 0, 0, 1648042348, 0, 0, 0, -628668919, 0, 0, 0, -936187417, 0, 0, 0, 1888390786, 0, 0, 0, 686661332, 0, 0, 0, -1873675855, 0, 0, 0, -2098964897, 0, 0, 0, 978858298, 0, 0, 0, -1483798141, 0, 0, 0, 523464422, 0, 0, 0, 226935048, 0, 0, 0, -1254447507, 0, 0, 0, -1119821404, 0, 0, 0, 100435649, 0, 0, 0, 390670639, 0, 0, 0, -1342878134, 0, 0, 0, 841119475, 0, 0, 0, -1969352298, 0, 0, 0, -1741963656, 0, 0, 0, 546822429, 0, 0, 0, 2029308235, 0, 0, 0, -1068978642, 0, 0, 0, -755170880, 0, 0, 0, 1782671013, 0, 0, 0, -141140452, 0, 0, 0, 1328167289, 0, 0, 0, 1570739863, 0, 0, 0, -450629134, 0, 0, 0, 1298864389, 0, 0, 0, -170426784, 0, 0, 0, -412954226, 0, 0, 0, 1608431339, 0, 0, 0, -1039561134, 0, 0, 0, 2058742071, 0, 0, 0, 1744848601, 0, 0, 0, -792976964, 0, 0, 0, -1998638614, 0, 0, 0, 811816591, 0, 0, 0, 584513889, 0, 0, 0, -1704288764, 0, 0, 0, 129869501, 0, 0, 0, -1090403880, 0, 0, 0, -1380684234, 0, 0, 0, 352848211, 0, 0, 0, 494030490, 0, 0, 0, -1513215489, 0, 0, 0, -1216641519, 0, 0, 0, 264757620, 0, 0, 0, -1844389427, 0, 0, 0, 715964072, 0, 0, 0, 941166918, 0, 0, 0, -2136639965, 0, 0, 0, -658086283, 0, 0, 0, 1618608400, 0, 0, 0, 1926213374, 0, 0, 0, -898381413, 0, 0, 0, 1470427426, 0, 0, 0, -283601337, 0, 0, 0, -38979159, 0, 0, 0, 1158766284, 0, 0, 0, 1984818694, 0, 0, 0, -823031453, 0, 0, 0, -599513459, 0, 0, 0, 1693991400, 0, 0, 0, -114329263, 0, 0, 0, 1100160564, 0, 0, 0, 1395044826, 0, 0, 0, -342174017, 0, 0, 0, -1275476247, 0, 0, 0, 189112716, 0, 0, 0, 435162722, 0, 0, 0, -1588827897, 0, 0, 0, 1016811966, 0, 0, 0, -2077804837, 0, 0, 0, -1768777419, 0, 0, 0, 774831696, 0, 0, 0, 643086745, 0, 0, 0, -1628905732, 0, 0, 0, -1940033262, 0, 0, 0, 887166583, 0, 0, 0, -1456066866, 0, 0, 0, 294275499, 0, 0, 0, 54519365, 0, 0, 0, -1149009632, 0, 0, 0, -471821962, 0, 0, 0, 1532818963, 0, 0, 0, 1240029693, 0, 0, 0, -246071656, 0, 0, 0, 1820460577, 0, 0, 0, -734109372, 0, 0, 0, -963916118, 0, 0, 0, 2117577167, 0, 0, 0, -696303304, 0, 0, 0, 1858283101, 0, 0, 0, 2088143283, 0, 0, 0, -993333546, 0, 0, 0, 1495127663, 0, 0, 0, -509497078, 0, 0, 0, -216785180, 0, 0, 0, 1269332353, 0, 0, 0, 332098007, 0, 0, 0, -1418260814, 0, 0, 0, -1178427044, 0, 0, 0, 25085497, 0, 0, 0, -1666580864, 0, 0, 0, 605395429, 0, 0, 0, 916469259, 0, 0, 0, -1910746770, 0, 0, 0, -2040129881, 0, 0, 0, 1054503362, 0, 0, 0, 745528876, 0, 0, 0, -1798063799, 0, 0, 0, 151290352, 0, 0, 0, -1313282411, 0, 0, 0, -1559410309, 0, 0, 0, 464596510, 0, 0, 0, 1137851976, 0, 0, 0, -76654291, 0, 0, 0, -371460413, 0, 0, 0, 1365741990, 0, 0, 0, -860837601, 0, 0, 0, 1946996346, 0, 0, 0, 1723425172, 0, 0, 0, -570095887, 0, 0, 0, 0, 0, 0, 0, -1775237257, 0, 0, 0, 744558318, 0, 0, 0, -1169094247, 0, 0, 0, 432303367, 0, 0, 0, -1879807376, 0, 0, 0, 900031465, 0, 0, 0, -1550490466, 0, 0, 0, 847829774, 0, 0, 0, -1531388807, 0, 0, 0, 518641120, 0, 0, 0, -1998990697, 0, 0, 0, 726447625, 0, 0, 0, -1115901570, 0, 0, 0, 120436967, 0, 0, 0, -1860321392, 0, 0, 0, 1678817053, 0, 0, 0, -232738710, 0, 0, 0, 1215412723, 0, 0, 0, -566116732, 0, 0, 0, 2111101466, 0, 0, 0, -337322643, 0, 0, 0, 1370871028, 0, 0, 0, -947530877, 0, 0, 0, 1452829715, 0, 0, 0, -1062704284, 0, 0, 0, 2063164157, 0, 0, 0, -322345590, 0, 0, 0, 1331429652, 0, 0, 0, -647231901, 0, 0, 0, 1664946170, 0, 0, 0, -183695219, 0, 0, 0, -937398725, 0, 0, 0, 1578133836, 0, 0, 0, -465477419, 0, 0, 0, 1920034722, 0, 0, 0, -773586116, 0, 0, 0, 1205077067, 0, 0, 0, -41611822, 0, 0, 0, 1807026853, 0, 0, 0, -89606859, 0, 0, 0, 1821946434, 0, 0, 0, -691422245, 0, 0, 0, 1090108588, 0, 0, 0, -479406030, 0, 0, 0, 1969020741, 0, 0, 0, -821176612, 0, 0, 0, 1497223595, 0, 0, 0, -1406084826, 0, 0, 0, 973135441, 0, 0, 0, -2142119992, 0, 0, 0, 375509183, 0, 0, 0, -1242254303, 0, 0, 0, 600093526, 0, 0, 0, -1718240561, 0, 0, 0, 262520248, 0, 0, 0, -1632107992, 0, 0, 0, 143131999, 0, 0, 0, -1294398266, 0, 0, 0, 619252657, 0, 0, 0, -2021888209, 0, 0, 0, 290220120, 0, 0, 0, -1424137791, 0, 0, 0, 1026385590, 0, 0, 0, -1874731914, 0, 0, 0, 108124929, 0, 0, 0, -1138699624, 0, 0, 0, 705746415, 0, 0, 0, -1987726991, 0, 0, 0, 532002310, 0, 0, 0, -1511735393, 0, 0, 0, 869578984, 0, 0, 0, -1563883656, 0, 0, 0, 888733711, 0, 0, 0, -1901590122, 0, 0, 0, 412618465, 0, 0, 0, -1156748673, 0, 0, 0, 759000328, 0, 0, 0, -1754504047, 0, 0, 0, 22832102, 0, 0, 0, -195990677, 0, 0, 0, 1650551836, 0, 0, 0, -667916923, 0, 0, 0, 1308648178, 0, 0, 0, -309000596, 0, 0, 0, 2074411291, 0, 0, 0, -1040971646, 0, 0, 0, 1472466933, 0, 0, 0, -958812059, 0, 0, 0, 1357494034, 0, 0, 0, -356991349, 0, 0, 0, 2089335292, 0, 0, 0, -551690910, 0, 0, 0, 1227741717, 0, 0, 0, -209923188, 0, 0, 0, 1699534075, 0, 0, 0, 1482797645, 0, 0, 0, -833505990, 0, 0, 0, 1946205347, 0, 0, 0, -500122668, 0, 0, 0, 1101389642, 0, 0, 0, -678045635, 0, 0, 0, 1841615268, 0, 0, 0, -67840301, 0, 0, 0, 1793681731, 0, 0, 0, -52859340, 0, 0, 0, 1183344557, 0, 0, 0, -793222950, 0, 0, 0, 1932330052, 0, 0, 0, -451083469, 0, 0, 0, 1598818986, 0, 0, 0, -914616867, 0, 0, 0, 1014039888, 0, 0, 0, -1438580185, 0, 0, 0, 269487038, 0, 0, 0, -2044719927, 0, 0, 0, 632645719, 0, 0, 0, -1283100896, 0, 0, 0, 164914873, 0, 0, 0, -1612422706, 0, 0, 0, 251256414, 0, 0, 0, -1731602135, 0, 0, 0, 580440240, 0, 0, 0, -1264003129, 0, 0, 0, 389919577, 0, 0, 0, -2129808338, 0, 0, 0, 995933623, 0, 0, 0, -1385383232, 0, 0, 0, 545503469, 0, 0, 0, -1229733990, 0, 0, 0, 216184323, 0, 0, 0, -1697468044, 0, 0, 0, 961009130, 0, 0, 0, -1351101795, 0, 0, 0, 354867972, 0, 0, 0, -2095653773, 0, 0, 0, 302736355, 0, 0, 0, -2076482412, 0, 0, 0, 1047162125, 0, 0, 0, -1470469510, 0, 0, 0, 198119140, 0, 0, 0, -1644230253, 0, 0, 0, 665714698, 0, 0, 0, -1315043459, 0, 0, 0, 1150488560, 0, 0, 0, -761067385, 0, 0, 0, 1760690462, 0, 0, 0, -20838807, 0, 0, 0, 1566008055, 0, 0, 0, -882416256, 0, 0, 0, 1899392025, 0, 0, 0, -419009682, 0, 0, 0, 1981535486, 0, 0, 0, -533998711, 0, 0, 0, 1518000656, 0, 0, 0, -867508889, 0, 0, 0, 1876933113, 0, 0, 0, -101728626, 0, 0, 0, 1136572183, 0, 0, 0, -712069024, 0, 0, 0, -391915818, 0, 0, 0, 2123616673, 0, 0, 0, -993863624, 0, 0, 0, 1391648591, 0, 0, 0, -244859951, 0, 0, 0, 1733803174, 0, 0, 0, -586762945, 0, 0, 0, 1261875784, 0, 0, 0, -634712616, 0, 0, 0, 1276840623, 0, 0, 0, -162921674, 0, 0, 0, 1618609217, 0, 0, 0, -1007722273, 0, 0, 0, 1440704424, 0, 0, 0, -275878351, 0, 0, 0, 2042521926, 0, 0, 0, -1934401077, 0, 0, 0, 444819132, 0, 0, 0, -1596821723, 0, 0, 0, 920807506, 0, 0, 0, -1787360052, 0, 0, 0, 54987707, 0, 0, 0, -1189739998, 0, 0, 0, 791020885, 0, 0, 0, -1103381819, 0, 0, 0, 671858098, 0, 0, 0, -1839549397, 0, 0, 0, 74101596, 0, 0, 0, -1476405310, 0, 0, 0, 835702965, 0, 0, 0, -1952523988, 0, 0, 0, 497999451, 0, 0, 0, -1329437541, 0, 0, 0, 653419500, 0, 0, 0, -1667011979, 0, 0, 0, 177433858, 0, 0, 0, -1459222116, 0, 0, 0, 1060507371, 0, 0, 0, -2056845454, 0, 0, 0, 324468741, 0, 0, 0, -2109030507, 0, 0, 0, 343587042, 0, 0, 0, -1372868229, 0, 0, 0, 941340172, 0, 0, 0, -1685138798, 0, 0, 0, 230610405, 0, 0, 0, -1209017220, 0, 0, 0, 568318731, 0, 0, 0, -724380794, 0, 0, 0, 1122161905, 0, 0, 0, -122430104, 0, 0, 0, 1854134815, 0, 0, 0, -854147455, 0, 0, 0, 1529264630, 0, 0, 0, -512249745, 0, 0, 0, 2001188632, 0, 0, 0, -430307192, 0, 0, 0, 1885999103, 0, 0, 0, -902101402, 0, 0, 0, 1544225041, 0, 0, 0, -6396529, 0, 0, 0, 1773036280, 0, 0, 0, -738235551, 0, 0, 0, 1171221526, 0, 0, 0, 2028079776, 0, 0, 0, -288223785, 0, 0, 0, 1417872462, 0, 0, 0, -1028455623, 0, 0, 0, 1629906855, 0, 0, 0, -149528368, 0, 0, 0, 1296525641, 0, 0, 0, -612929986, 0, 0, 0, 1248514478, 0, 0, 0, -598026535, 0, 0, 0, 1712054080, 0, 0, 0, -264513481, 0, 0, 0, 1403960489, 0, 0, 0, -979452962, 0, 0, 0, 2144318023, 0, 0, 0, -369117904, 0, 0, 0, 485670333, 0, 0, 0, -1966949686, 0, 0, 0, 814986067, 0, 0, 0, -1499220956, 0, 0, 0, 87478458, 0, 0, 0, -1828268083, 0, 0, 0, 693624404, 0, 0, 0, -1083713245, 0, 0, 0, 779773619, 0, 0, 0, -1203084860, 0, 0, 0, 35350621, 0, 0, 0, -1809092822, 0, 0, 0, 935201716, 0, 0, 0, -1584526141, 0, 0, 0, 467600730, 0, 0, 0, -1913716179, 0, 0, 0, 0, 0, 0, 0, 1093737241, 0, 0, 0, -2107492814, 0, 0, 0, -1017959125, 0, 0, 0, 80047204, 0, 0, 0, 1173649277, 0, 0, 0, -2035852714, 0, 0, 0, -946454193, 0, 0, 0, 143317448, 0, 0, 0, 1237041873, 0, 0, 0, -1964445702, 0, 0, 0, -874908445, 0, 0, 0, 206550444, 0, 0, 0, 1300147893, 0, 0, 0, -1909619810, 0, 0, 0, -820209529, 0, 0, 0, 1360183882, 0, 0, 0, 270784851, 0, 0, 0, -747572104, 0, 0, 0, -1841172639, 0, 0, 0, 1440198190, 0, 0, 0, 350663991, 0, 0, 0, -675964900, 0, 0, 0, -1769700603, 0, 0, 0, 1503140738, 0, 0, 0, 413728923, 0, 0, 0, -604361296, 0, 0, 0, -1697958231, 0, 0, 0, 1566406630, 0, 0, 0, 476867839, 0, 0, 0, -549502508, 0, 0, 0, -1643226419, 0, 0, 0, -1574665067, 0, 0, 0, -485122164, 0, 0, 0, 541504167, 0, 0, 0, 1635232190, 0, 0, 0, -1495144207, 0, 0, 0, -405736472, 0, 0, 0, 612622019, 0, 0, 0, 1706214874, 0, 0, 0, -1431413411, 0, 0, 0, -341883324, 0, 0, 0, 684485487, 0, 0, 0, 1778217078, 0, 0, 0, -1368706759, 0, 0, 0, -279303648, 0, 0, 0, 738789131, 0, 0, 0, 1832393746, 0, 0, 0, -214546721, 0, 0, 0, -1308140090, 0, 0, 0, 1901359341, 0, 0, 0, 811953140, 0, 0, 0, -135058757, 0, 0, 0, -1228787294, 0, 0, 0, 1972444297, 0, 0, 0, 882902928, 0, 0, 0, -71524585, 0, 0, 0, -1165130738, 0, 0, 0, 2044635429, 0, 0, 0, 955232828, 0, 0, 0, -8785037, 0, 0, 0, -1102518166, 0, 0, 0, 2098971969, 0, 0, 0, 1009442392, 0, 0, 0, 89094640, 0, 0, 0, 1149133545, 0, 0, 0, -2027073598, 0, 0, 0, -971221797, 0, 0, 0, 25826708, 0, 0, 0, 1086000781, 0, 0, 0, -2081938522, 0, 0, 0, -1025951553, 0, 0, 0, 231055416, 0, 0, 0, 1291107105, 0, 0, 0, -1884842486, 0, 0, 0, -828994285, 0, 0, 0, 151047260, 0, 0, 0, 1211225925, 0, 0, 0, -1956447634, 0, 0, 0, -900472457, 0, 0, 0, 1415429050, 0, 0, 0, 359440547, 0, 0, 0, -700478072, 0, 0, 0, -1760651631, 0, 0, 0, 1352194014, 0, 0, 0, 296340679, 0, 0, 0, -755310100, 0, 0, 0, -1815348491, 0, 0, 0, 1557619314, 0, 0, 0, 501643627, 0, 0, 0, -558541760, 0, 0, 0, -1618718887, 0, 0, 0, 1477578262, 0, 0, 0, 421729551, 0, 0, 0, -630179804, 0, 0, 0, -1690229955, 0, 0, 0, -1486095003, 0, 0, 0, -430250372, 0, 0, 0, 621398871, 0, 0, 0, 1681444942, 0, 0, 0, -1548840703, 0, 0, 0, -492860904, 0, 0, 0, 567060275, 0, 0, 0, 1627241514, 0, 0, 0, -1344199507, 0, 0, 0, -288342092, 0, 0, 0, 763564703, 0, 0, 0, 1823607174, 0, 0, 0, -1423685431, 0, 0, 0, -367701040, 0, 0, 0, 692485883, 0, 0, 0, 1752655330, 0, 0, 0, -159826129, 0, 0, 0, -1220008906, 0, 0, 0, 1947928861, 0, 0, 0, 891949572, 0, 0, 0, -222538933, 0, 0, 0, -1282586542, 0, 0, 0, 1893623161, 0, 0, 0, 837779040, 0, 0, 0, -17570073, 0, 0, 0, -1077740034, 0, 0, 0, 2089930965, 0, 0, 0, 1033948108, 0, 0, 0, -97088893, 0, 0, 0, -1157131878, 0, 0, 0, 2018819249, 0, 0, 0, 962963368, 0, 0, 0, 1268286267, 0, 0, 0, 178886690, 0, 0, 0, -906316535, 0, 0, 0, -1999917552, 0, 0, 0, 1331556191, 0, 0, 0, 242021446, 0, 0, 0, -851453587, 0, 0, 0, -1945189772, 0, 0, 0, 1125276403, 0, 0, 0, 35865066, 0, 0, 0, -1049596735, 0, 0, 0, -2143193128, 0, 0, 0, 1205286551, 0, 0, 0, 115748238, 0, 0, 0, -977993563, 0, 0, 0, -2071716932, 0, 0, 0, 445268337, 0, 0, 0, 1539005032, 0, 0, 0, -1729595581, 0, 0, 0, -640062374, 0, 0, 0, 508505365, 0, 0, 0, 1602106892, 0, 0, 0, -1674765529, 0, 0, 0, -585367490, 0, 0, 0, 302028985, 0, 0, 0, 1395753888, 0, 0, 0, -1872580981, 0, 0, 0, -783043182, 0, 0, 0, 382072029, 0, 0, 0, 1475669956, 0, 0, 0, -1800944913, 0, 0, 0, -711534090, 0, 0, 0, -373553234, 0, 0, 0, -1467147081, 0, 0, 0, 1809723804, 0, 0, 0, 720317061, 0, 0, 0, -310809654, 0, 0, 0, -1404538669, 0, 0, 0, 1864064504, 0, 0, 0, 774522593, 0, 0, 0, -516497818, 0, 0, 0, -1610103425, 0, 0, 0, 1666508884, 0, 0, 0, 577106765, 0, 0, 0, -437014014, 0, 0, 0, -1530746597, 0, 0, 0, 1737589808, 0, 0, 0, 648060713, 0, 0, 0, -1196505628, 0, 0, 0, -106963203, 0, 0, 0, 986510294, 0, 0, 0, 2080237775, 0, 0, 0, -1133794944, 0, 0, 0, -44387687, 0, 0, 0, 1040818098, 0, 0, 0, 2134410411, 0, 0, 0, -1339810772, 0, 0, 0, -250280139, 0, 0, 0, 843459102, 0, 0, 0, 1937191175, 0, 0, 0, -1260294072, 0, 0, 0, -170890415, 0, 0, 0, 914572922, 0, 0, 0, 2008178019, 0, 0, 0, 1322777291, 0, 0, 0, 266789330, 0, 0, 0, -860500743, 0, 0, 0, -1920673824, 0, 0, 0, 1242732207, 0, 0, 0, 186879414, 0, 0, 0, -932142947, 0, 0, 0, -1992180860, 0, 0, 0, 1180508931, 0, 0, 0, 124532762, 0, 0, 0, -1002498767, 0, 0, 0, -2062676440, 0, 0, 0, 1117278055, 0, 0, 0, 61428862, 0, 0, 0, -1057326763, 0, 0, 0, -2117377460, 0, 0, 0, 533018753, 0, 0, 0, 1593058200, 0, 0, 0, -1649996109, 0, 0, 0, -594143830, 0, 0, 0, 453006565, 0, 0, 0, 1513181180, 0, 0, 0, -1721605417, 0, 0, 0, -665617970, 0, 0, 0, 391110985, 0, 0, 0, 1451162192, 0, 0, 0, -1792157829, 0, 0, 0, -736310174, 0, 0, 0, 327847213, 0, 0, 0, 1388025396, 0, 0, 0, -1847018721, 0, 0, 0, -791044090, 0, 0, 0, -319586722, 0, 0, 0, -1379769017, 0, 0, 0, 1855015020, 0, 0, 0, 799036277, 0, 0, 0, -399109574, 0, 0, 0, -1459156701, 0, 0, 0, 1783899144, 0, 0, 0, 728055569, 0, 0, 0, -461789290, 0, 0, 0, -1521959793, 0, 0, 0, 1713082788, 0, 0, 0, 657099453, 0, 0, 0, -524497934, 0, 0, 0, -1584541461, 0, 0, 0, 1658781120, 0, 0, 0, 602924761, 0, 0, 0, -1109279724, 0, 0, 0, -53434611, 0, 0, 0, 1065585190, 0, 0, 0, 2125631807, 0, 0, 0, -1188769680, 0, 0, 0, -132789399, 0, 0, 0, 994502210, 0, 0, 0, 2054683995, 0, 0, 0, -1251252772, 0, 0, 0, -195395899, 0, 0, 0, 923358190, 0, 0, 0, 1983400183, 0, 0, 0, -1313994312, 0, 0, 0, -258010463, 0, 0, 0, 869023626, 0, 0, 0, 1929192595, 0, 0, 0, 0, 0, 0, 0, 929743361, 0, 0, 0, 1859421187, 0, 0, 0, 1505641986, 0, 0, 0, -592967417, 0, 0, 0, -339555578, 0, 0, 0, -1300460284, 0, 0, 0, -2062135547, 0, 0, 0, -1202646258, 0, 0, 0, -1891905265, 0, 0, 0, -695888115, 0, 0, 0, -504408820, 0, 0, 0, 1694046729, 0, 0, 0, 1402198024, 0, 0, 0, 170761738, 0, 0, 0, 1028086795, 0, 0, 0, 1889740316, 0, 0, 0, 1204413469, 0, 0, 0, 511156767, 0, 0, 0, 689791006, 0, 0, 0, -1408553189, 0, 0, 0, -1688081126, 0, 0, 0, -1025529064, 0, 0, 0, -172660455, 0, 0, 0, -923650798, 0, 0, 0, -6752493, 0, 0, 0, -1507413743, 0, 0, 0, -1857260784, 0, 0, 0, 341457941, 0, 0, 0, 590413332, 0, 0, 0, 2056173590, 0, 0, 0, 1306819095, 0, 0, 0, -532263624, 0, 0, 0, -684945607, 0, 0, 0, -1902982853, 0, 0, 0, -1174926534, 0, 0, 0, 1022247999, 0, 0, 0, 193234494, 0, 0, 0, 1379582012, 0, 0, 0, 1699742269, 0, 0, 0, 1477926454, 0, 0, 0, 1870502967, 0, 0, 0, 918805045, 0, 0, 0, 27858996, 0, 0, 0, -2067835087, 0, 0, 0, -1277848272, 0, 0, 0, -362032334, 0, 0, 0, -587132621, 0, 0, 0, -1864013020, 0, 0, 0, -1483757275, 0, 0, 0, -30281945, 0, 0, 0, -916771546, 0, 0, 0, 1280139811, 0, 0, 0, 2066194466, 0, 0, 0, 580511264, 0, 0, 0, 368256033, 0, 0, 0, 682915882, 0, 0, 0, 534690347, 0, 0, 0, 1180761129, 0, 0, 0, 1896496680, 0, 0, 0, -199462611, 0, 0, 0, -1015631060, 0, 0, 0, -1698106066, 0, 0, 0, -1381877969, 0, 0, 0, -1064461712, 0, 0, 0, -135833487, 0, 0, 0, -1369891213, 0, 0, 0, -1724654478, 0, 0, 0, 472224631, 0, 0, 0, 726618486, 0, 0, 0, 1928402804, 0, 0, 0, 1167840629, 0, 0, 0, 2027719038, 0, 0, 0, 1337346943, 0, 0, 0, 369626493, 0, 0, 0, 560123772, 0, 0, 0, -1535868807, 0, 0, 0, -1826733448, 0, 0, 0, -895482758, 0, 0, 0, -37042565, 0, 0, 0, -1339114388, 0, 0, 0, -2025554323, 0, 0, 0, -554026897, 0, 0, 0, -376374674, 0, 0, 0, 1820767595, 0, 0, 0, 1542223722, 0, 0, 0, 38941032, 0, 0, 0, 892924777, 0, 0, 0, 142585698, 0, 0, 0, 1058368867, 0, 0, 0, 1722493793, 0, 0, 0, 1371662688, 0, 0, 0, -724064667, 0, 0, 0, -474127260, 0, 0, 0, -1174199706, 0, 0, 0, -1922441113, 0, 0, 0, 550229832, 0, 0, 0, 396432713, 0, 0, 0, 1310675787, 0, 0, 0, 2037748042, 0, 0, 0, -60563889, 0, 0, 0, -888595378, 0, 0, 0, -1833477556, 0, 0, 0, -1512204211, 0, 0, 0, -1734687674, 0, 0, 0, -1343224249, 0, 0, 0, -162643899, 0, 0, 0, -1054571964, 0, 0, 0, 1144180033, 0, 0, 0, 1935150912, 0, 0, 0, 719735106, 0, 0, 0, 495749955, 0, 0, 0, 1349054804, 0, 0, 0, 1728197461, 0, 0, 0, 1052538199, 0, 0, 0, 165066582, 0, 0, 0, -1933510573, 0, 0, 0, -1146471854, 0, 0, 0, -501973936, 0, 0, 0, -713114031, 0, 0, 0, -398859686, 0, 0, 0, -548200357, 0, 0, 0, -2031262119, 0, 0, 0, -1316510632, 0, 0, 0, 881978205, 0, 0, 0, 66791772, 0, 0, 0, 1514499934, 0, 0, 0, 1831841119, 0, 0, 0, -2145700383, 0, 0, 0, -1217267744, 0, 0, 0, -288378398, 0, 0, 0, -643468317, 0, 0, 0, 1555250406, 0, 0, 0, 1809448679, 0, 0, 0, 845658341, 0, 0, 0, 84769508, 0, 0, 0, 944383727, 0, 0, 0, 253813998, 0, 0, 0, 1453236972, 0, 0, 0, 1643405549, 0, 0, 0, -454938648, 0, 0, 0, -746000919, 0, 0, 0, -1976128533, 0, 0, 0, -1118017046, 0, 0, 0, -256371715, 0, 0, 0, -942484996, 0, 0, 0, -1637050370, 0, 0, 0, -1459202561, 0, 0, 0, 739252986, 0, 0, 0, 461035771, 0, 0, 0, 1120182009, 0, 0, 0, 1974361336, 0, 0, 0, 1223229683, 0, 0, 0, 2139341554, 0, 0, 0, 641565936, 0, 0, 0, 290932465, 0, 0, 0, -1807676940, 0, 0, 0, -1557410827, 0, 0, 0, -90862089, 0, 0, 0, -838905866, 0, 0, 0, 1616738521, 0, 0, 0, 1463270104, 0, 0, 0, 243924186, 0, 0, 0, 971194075, 0, 0, 0, -1124765218, 0, 0, 0, -1952468001, 0, 0, 0, -769526307, 0, 0, 0, -448055332, 0, 0, 0, -670274601, 0, 0, 0, -278484522, 0, 0, 0, -1227296812, 0, 0, 0, -2119029291, 0, 0, 0, 77882064, 0, 0, 0, 869179601, 0, 0, 0, 1785784019, 0, 0, 0, 1561994450, 0, 0, 0, 285105861, 0, 0, 0, 664050884, 0, 0, 0, 2116737734, 0, 0, 0, 1228937415, 0, 0, 0, -866756670, 0, 0, 0, -79915581, 0, 0, 0, -1568484415, 0, 0, 0, -1779953216, 0, 0, 0, -1464906293, 0, 0, 0, -1614442550, 0, 0, 0, -964965944, 0, 0, 0, -250541111, 0, 0, 0, 1946633420, 0, 0, 0, 1131251405, 0, 0, 0, 450085071, 0, 0, 0, 767099598, 0, 0, 0, 1083617169, 0, 0, 0, 2013031824, 0, 0, 0, 776088466, 0, 0, 0, 422111635, 0, 0, 0, -1673615722, 0, 0, 0, -1420532585, 0, 0, 0, -219536747, 0, 0, 0, -981409644, 0, 0, 0, -121127777, 0, 0, 0, -810713442, 0, 0, 0, -1777125220, 0, 0, 0, -1585841507, 0, 0, 0, 611300760, 0, 0, 0, 319125401, 0, 0, 0, 1253781915, 0, 0, 0, 2110911386, 0, 0, 0, 808814989, 0, 0, 0, 123685772, 0, 0, 0, 1591807374, 0, 0, 0, 1770770319, 0, 0, 0, -325222262, 0, 0, 0, -604552565, 0, 0, 0, -2109143927, 0, 0, 0, -1255946616, 0, 0, 0, -2006672765, 0, 0, 0, -1089578878, 0, 0, 0, -424665472, 0, 0, 0, -774185855, 0, 0, 0, 1422693252, 0, 0, 0, 1671844229, 0, 0, 0, 974657415, 0, 0, 0, 225629574, 0, 0, 0, -1596923223, 0, 0, 0, -1749409624, 0, 0, 0, -838572374, 0, 0, 0, -110189397, 0, 0, 0, 2088299438, 0, 0, 0, 1259481519, 0, 0, 0, 313290669, 0, 0, 0, 633777580, 0, 0, 0, 411169191, 0, 0, 0, 803943334, 0, 0, 0, 1985312164, 0, 0, 0, 1094694821, 0, 0, 0, -1003882336, 0, 0, 0, -213697887, 0, 0, 0, -1426228061, 0, 0, 0, -1650999646, 0, 0, 0, -797719371, 0, 0, 0, -417790284, 0, 0, 0, -1096335178, 0, 0, 0, -1983020361, 0, 0, 0, 215731634, 0, 0, 0, 1001459635, 0, 0, 0, 1645169073, 0, 0, 0, 1432718256, 0, 0, 0, 1747113915, 0, 0, 0, 1598559674, 0, 0, 0, 116806584, 0, 0, 0, 832344505, 0, 0, 0, -1265967428, 0, 0, 0, -2082464579, 0, 0, 0, -631350593, 0, 0, 0, -315320130, 0, 0, 0, 0, 0, 0, 0, 1701297336, 0, 0, 0, -1949824598, 0, 0, 0, -290474734, 0, 0, 0, 1469538959, 0, 0, 0, 854646327, 0, 0, 0, -597726427, 0, 0, 0, -1187457123, 0, 0, 0, -282544955, 0, 0, 0, -1974531971, 0, 0, 0, 1692450159, 0, 0, 0, 25625047, 0, 0, 0, -1195387318, 0, 0, 0, -573019406, 0, 0, 0, 863494112, 0, 0, 0, 1443914584, 0, 0, 0, -1621681840, 0, 0, 0, -97475096, 0, 0, 0, 345968890, 0, 0, 0, 1912122434, 0, 0, 0, -926909473, 0, 0, 0, -1381513369, 0, 0, 0, 1124627061, 0, 0, 0, 644861645, 0, 0, 0, 1887415701, 0, 0, 0, 353898797, 0, 0, 0, -71850945, 0, 0, 0, -1630529401, 0, 0, 0, 669568794, 0, 0, 0, 1116697506, 0, 0, 0, -1407138128, 0, 0, 0, -918062584, 0, 0, 0, 1051669152, 0, 0, 0, 1539870232, 0, 0, 0, -1251525878, 0, 0, 0, -805271630, 0, 0, 0, 1765298223, 0, 0, 0, 207613079, 0, 0, 0, -487564923, 0, 0, 0, -2020088515, 0, 0, 0, -779647387, 0, 0, 0, -1260373283, 0, 0, 0, 1515163599, 0, 0, 0, 1059599223, 0, 0, 0, -2045713174, 0, 0, 0, -478717870, 0, 0, 0, 232320320, 0, 0, 0, 1757368824, 0, 0, 0, -1577571344, 0, 0, 0, -996174008, 0, 0, 0, 707797594, 0, 0, 0, 1331142370, 0, 0, 0, -160478849, 0, 0, 0, -1828129337, 0, 0, 0, 2108113109, 0, 0, 0, 415300717, 0, 0, 0, 1322295093, 0, 0, 0, 733422477, 0, 0, 0, -988244321, 0, 0, 0, -1602278873, 0, 0, 0, 424148410, 0, 0, 0, 2082488578, 0, 0, 0, -1836059632, 0, 0, 0, -135771992, 0, 0, 0, 1029182619, 0, 0, 0, 1480566819, 0, 0, 0, -1232069327, 0, 0, 0, -738745975, 0, 0, 0, 1791981076, 0, 0, 0, 262720172, 0, 0, 0, -519602242, 0, 0, 0, -2074033402, 0, 0, 0, -764370850, 0, 0, 0, -1223222042, 0, 0, 0, 1505274356, 0, 0, 0, 1021252940, 0, 0, 0, -2048408879, 0, 0, 0, -528449943, 0, 0, 0, 238013307, 0, 0, 0, 1799911363, 0, 0, 0, -1576071733, 0, 0, 0, -949440141, 0, 0, 0, 700908641, 0, 0, 0, 1285601497, 0, 0, 0, -174559420, 0, 0, 0, -1862282244, 0, 0, 0, 2119198446, 0, 0, 0, 456645206, 0, 0, 0, 1294448910, 0, 0, 0, 675284406, 0, 0, 0, -957370204, 0, 0, 0, -1551365092, 0, 0, 0, 447798145, 0, 0, 0, 2144823097, 0, 0, 0, -1854352853, 0, 0, 0, -199266669, 0, 0, 0, 66528827, 0, 0, 0, 1720752771, 0, 0, 0, -2009124975, 0, 0, 0, -312962263, 0, 0, 0, 1415595188, 0, 0, 0, 822605836, 0, 0, 0, -542618338, 0, 0, 0, -1160777306, 0, 0, 0, -320892162, 0, 0, 0, -1984418234, 0, 0, 0, 1729600340, 0, 0, 0, 40904684, 0, 0, 0, -1152847759, 0, 0, 0, -567325495, 0, 0, 0, 813758939, 0, 0, 0, 1441219939, 0, 0, 0, -1667219605, 0, 0, 0, -104365101, 0, 0, 0, 392705729, 0, 0, 0, 1913621113, 0, 0, 0, -885563932, 0, 0, 0, -1370431140, 0, 0, 0, 1090475086, 0, 0, 0, 630778102, 0, 0, 0, 1938328494, 0, 0, 0, 384775958, 0, 0, 0, -129990140, 0, 0, 0, -1658372420, 0, 0, 0, 606071073, 0, 0, 0, 1098405273, 0, 0, 0, -1344806773, 0, 0, 0, -894411725, 0, 0, 0, 1001806317, 0, 0, 0, 1590814037, 0, 0, 0, -1333899193, 0, 0, 0, -719721217, 0, 0, 0, 1814117218, 0, 0, 0, 155617242, 0, 0, 0, -404147512, 0, 0, 0, -2104586640, 0, 0, 0, -727782104, 0, 0, 0, -1309060720, 0, 0, 0, 1599530114, 0, 0, 0, 976312378, 0, 0, 0, -2096525401, 0, 0, 0, -428985569, 0, 0, 0, 146900493, 0, 0, 0, 1839610549, 0, 0, 0, -1528741699, 0, 0, 0, -1048118267, 0, 0, 0, 791234839, 0, 0, 0, 1246688687, 0, 0, 0, -210361806, 0, 0, 0, -1777230198, 0, 0, 0, 2025728920, 0, 0, 0, 500799264, 0, 0, 0, 1271526520, 0, 0, 0, 783173824, 0, 0, 0, -1073611310, 0, 0, 0, -1520025238, 0, 0, 0, 475961079, 0, 0, 0, 2033789519, 0, 0, 0, -1751736483, 0, 0, 0, -219077659, 0, 0, 0, 85551949, 0, 0, 0, 1618925557, 0, 0, 0, -1898880281, 0, 0, 0, -340337057, 0, 0, 0, 1385040322, 0, 0, 0, 938063226, 0, 0, 0, -649723800, 0, 0, 0, -1138639664, 0, 0, 0, -365830264, 0, 0, 0, -1890163920, 0, 0, 0, 1643763234, 0, 0, 0, 77490842, 0, 0, 0, -1113146105, 0, 0, 0, -658439745, 0, 0, 0, 913224877, 0, 0, 0, 1393100821, 0, 0, 0, -1706135011, 0, 0, 0, -14037339, 0, 0, 0, 294026167, 0, 0, 0, 1960953615, 0, 0, 0, -841412462, 0, 0, 0, -1463899094, 0, 0, 0, 1175525688, 0, 0, 0, 594978176, 0, 0, 0, 1969669848, 0, 0, 0, 268532320, 0, 0, 0, -22098062, 0, 0, 0, -1681296438, 0, 0, 0, 586261591, 0, 0, 0, 1201019119, 0, 0, 0, -1455837699, 0, 0, 0, -866250427, 0, 0, 0, 116280694, 0, 0, 0, 1669984718, 0, 0, 0, -1926871844, 0, 0, 0, -398329756, 0, 0, 0, 1366896633, 0, 0, 0, 874419009, 0, 0, 0, -625924525, 0, 0, 0, -1076454677, 0, 0, 0, -372835917, 0, 0, 0, -1935588085, 0, 0, 0, 1645146137, 0, 0, 0, 124341409, 0, 0, 0, -1101948100, 0, 0, 0, -617207932, 0, 0, 0, 899256982, 0, 0, 0, 1358835246, 0, 0, 0, -1715907546, 0, 0, 0, -52500322, 0, 0, 0, 309419404, 0, 0, 0, 1997988148, 0, 0, 0, -835832151, 0, 0, 0, -1421243887, 0, 0, 0, 1172717315, 0, 0, 0, 545358779, 0, 0, 0, 1989271779, 0, 0, 0, 334912603, 0, 0, 0, -44439223, 0, 0, 0, -1740745231, 0, 0, 0, 554074732, 0, 0, 0, 1147223764, 0, 0, 0, -1429304378, 0, 0, 0, -810993794, 0, 0, 0, 943816662, 0, 0, 0, 1562821486, 0, 0, 0, -1282836868, 0, 0, 0, -688993596, 0, 0, 0, 1876303193, 0, 0, 0, 179413473, 0, 0, 0, -467790605, 0, 0, 0, -2122733493, 0, 0, 0, -680932589, 0, 0, 0, -1307674709, 0, 0, 0, 1554105017, 0, 0, 0, 969309697, 0, 0, 0, -2130794084, 0, 0, 0, -442952412, 0, 0, 0, 188129334, 0, 0, 0, 1850809486, 0, 0, 0, -1491704186, 0, 0, 0, -1032725954, 0, 0, 0, 752774956, 0, 0, 0, 1236915092, 0, 0, 0, -259980279, 0, 0, 0, -1780041551, 0, 0, 0, 2068385187, 0, 0, 0, 506376475, 0, 0, 0, 1212076611, 0, 0, 0, 760835835, 0, 0, 0, -1007232023, 0, 0, 0, -1500420271, 0, 0, 0, 531214540, 0, 0, 0, 2060323956, 0, 0, 0, -1805534874, 0, 0, 0, -251263522, 0, 0, 0 ], [ "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0 ], ALLOC_STATIC);

STRING_TABLE.__str455 = allocate([ 115, 116, 114, 101, 97, 109, 32, 101, 114, 114, 111, 114, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str657 = allocate([ 105, 110, 115, 117, 102, 102, 105, 99, 105, 101, 110, 116, 32, 109, 101, 109, 111, 114, 121, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str758 = allocate([ 98, 117, 102, 102, 101, 114, 32, 101, 114, 114, 111, 114, 0 ], "i8", ALLOC_STATIC);

_inflate_table_lbase = allocate([ 3, 0, 4, 0, 5, 0, 6, 0, 7, 0, 8, 0, 9, 0, 10, 0, 11, 0, 13, 0, 15, 0, 17, 0, 19, 0, 23, 0, 27, 0, 31, 0, 35, 0, 43, 0, 51, 0, 59, 0, 67, 0, 83, 0, 99, 0, 115, 0, 131, 0, 163, 0, 195, 0, 227, 0, 258, 0, 0, 0, 0, 0 ], [ "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0 ], ALLOC_STATIC);

_inflate_table_lext = allocate([ 16, 0, 16, 0, 16, 0, 16, 0, 16, 0, 16, 0, 16, 0, 16, 0, 17, 0, 17, 0, 17, 0, 17, 0, 18, 0, 18, 0, 18, 0, 18, 0, 19, 0, 19, 0, 19, 0, 19, 0, 20, 0, 20, 0, 20, 0, 20, 0, 21, 0, 21, 0, 21, 0, 21, 0, 16, 0, 73, 0, 195, 0 ], [ "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0 ], ALLOC_STATIC);

_inflate_table_dbase = allocate([ 1, 0, 2, 0, 3, 0, 4, 0, 5, 0, 7, 0, 9, 0, 13, 0, 17, 0, 25, 0, 33, 0, 49, 0, 65, 0, 97, 0, 129, 0, 193, 0, 257, 0, 385, 0, 513, 0, 769, 0, 1025, 0, 1537, 0, 2049, 0, 3073, 0, 4097, 0, 6145, 0, 8193, 0, 12289, 0, 16385, 0, 24577, 0, 0, 0, 0, 0 ], [ "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0 ], ALLOC_STATIC);

_inflate_table_dext = allocate([ 16, 0, 16, 0, 16, 0, 16, 0, 17, 0, 17, 0, 18, 0, 18, 0, 19, 0, 19, 0, 20, 0, 20, 0, 21, 0, 21, 0, 22, 0, 22, 0, 23, 0, 23, 0, 24, 0, 24, 0, 25, 0, 25, 0, 26, 0, 26, 0, 27, 0, 27, 0, 28, 0, 28, 0, 29, 0, 29, 0, 64, 0, 64, 0 ], [ "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0, "i16", 0 ], ALLOC_STATIC);

STRING_TABLE.__str69 = allocate([ 105, 110, 118, 97, 108, 105, 100, 32, 100, 105, 115, 116, 97, 110, 99, 101, 32, 116, 111, 111, 32, 102, 97, 114, 32, 98, 97, 99, 107, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str170 = allocate([ 105, 110, 118, 97, 108, 105, 100, 32, 100, 105, 115, 116, 97, 110, 99, 101, 32, 99, 111, 100, 101, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str271 = allocate([ 105, 110, 118, 97, 108, 105, 100, 32, 108, 105, 116, 101, 114, 97, 108, 47, 108, 101, 110, 103, 116, 104, 32, 99, 111, 100, 101, 0 ], "i8", ALLOC_STATIC);

__gm_ = allocate(468, [ "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "*", 0, 0, 0, "i32", 0, 0, 0, "*", 0, 0, 0, "i32", 0, 0, 0, "*", 0, 0, 0, "i32", 0, 0, 0 ], ALLOC_STATIC);

_mparams = allocate(24, "i32", ALLOC_STATIC);

HEAP[_static_l_desc] = _static_ltree | 0;

HEAP[_static_l_desc + 4] = _extra_lbits | 0;

HEAP[_static_d_desc] = _static_dtree | 0;

HEAP[_static_d_desc + 4] = _extra_dbits | 0;

HEAP[_static_bl_desc + 4] = _extra_blbits | 0;

FUNCTION_TABLE = [ 0, 0, _zcalloc, 0, _zcfree, 0, _deflate_stored, 0, _deflate_fast, 0, _deflate_slow, 0 ];

Module["FUNCTION_TABLE"] = FUNCTION_TABLE;
