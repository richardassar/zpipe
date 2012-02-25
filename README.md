# Z'PIPE!

zpipe is **not** a pipe.

!["Ceci n'est pas une pipe"](http://upload.wikimedia.org/wikipedia/en/thumb/b/b9/MagrittePipe.jpg/300px-MagrittePipe.jpg "Ceci n'est pas une pipe")

>The famous pipe. How people reproached me for it! And yet, could you stuff my pipe? No, it's just a representation, is it not? So if I had written on my picture "This is a pipe," I'd have been lying!

## About

z'pipe exposes an interface to the [DEFLATE](http://www.ietf.org/rfc/rfc1951.txt) algorithm of the [ZLib](http://zlib.net/) compression library, it has been cross-compiled from the ZLib source with [emscripten](https://github.com/kripken/emscripten).

## Why?

* Poor upload bandwidth
* Currently no compression API exposed in browsers
* You might want to compress IDAT chunks of client-side generated PNG images ;)
* You might like pipes...

## Browser requirements

The ZLib library cannot currently be cross-compiled without the use of typed arrays. Until I investiage a solution to this use of zpipe is restricted to [browsers which support typed arrays](http://caniuse.com/typedarrays).

**Packing in the Browser**

    <script type="text/javascript" src="zpipe.min.js"></script>

    <script>
         var deflated = zpipe.deflate("the balloon");

         var inflated = zpipe.inflate(deflated); // "the balloon"
    </script>

**Packing with Ender / Node**

**Note**: Node.js already has [zlib bindings](http://nodejs.org/docs/v0.6.0/api/zlib.html) but we want automated testing and browser-side require (**Ender**, **Browserify**) support.

    var zpipe = require("zpipe");
    
    var deflated = zpipe.deflate("the balloon");

    var inflated = zpipe.inflate(deflated); // "the balloon"

## Notes

z'pipe works on octet strings only, throw UTF-16 encoded characters at it and it will ignore the high byte.

## TODO

* Support streaming compression through workers
* Performance benchmarks
* Use a unit test framework (nodeunit, mocha)
* Package for Ender
* NPM publish
