# Z'PIPE!

zpipe is **not** a pipe, but it **is** the pipe you are looking for.

<center>
!["Ceci n'est pas une pipe"](http://upload.wikimedia.org/wikipedia/en/thumb/b/b9/MagrittePipe.jpg/300px-MagrittePipe.jpg "Ceci n'est pas une pipe")
</center>

>The famous pipe. How people reproached me for it! And yet, could you stuff my pipe? No, it's just a representation, is it not? So if I had written on my picture "This is a pipe," I'd have been lying!

## About

z'pipe exposes an interface to the DEFLATE algorithm of the [ZLib](http://zlib.net/) compression library, it has been cross-compiled from the ZLib source with [emscripten](https://github.com/kripken/emscripten).

## Why?

* Poor upload bandwidth
* Currently no client-side compression API in browsers
* You might want to compress IDAT chunks of client-side generated PNG images
* You might like pipes

**Smoking in the Browser**

    <script type="text/javascript" src="zpipe.min.js"></script>

    <script>
         var deflated = zpipe.deflate("the balloon");

         var inflated = zpipe.inflate("deflated"); // "the balloon"
    </script>

**Smoking with Ender/Node**

Note: Node alread has zlib [bindings](http://nodejs.org/docs/v0.6.0/api/zlib.html) this exampl

    var zpipe = require("zpipe");
    
    var deflated = zpipe.deflate("the balloon");

    var inflated = zpipe.inflate("deflated"); // "the balloon"

## TODO

* Benchmark
* Stress test
* package.json
* Ender / NPM publish
