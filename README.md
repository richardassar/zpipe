# Z'PIPE!

zpipe is **not** a pipe.

!["Ceci n'est pas une pipe"](http://upload.wikimedia.org/wikipedia/en/thumb/b/b9/MagrittePipe.jpg/300px-MagrittePipe.jpg "Ceci n'est pas une pipe")

>The famous pipe. How people reproached me for it! And yet, could you stuff my pipe? No, it's just a representation, is it not? So if I had written on my picture "This is a pipe," I'd have been lying!

## About

z'pipe exposes an interface to the [DEFLATE](http://www.ietf.org/rfc/rfc1951.txt) algorithm of the [ZLib](http://zlib.net/) compression library, it has been cross-compiled to JavaScript with [Emscripten](https://github.com/kripken/emscripten).

## Motivation

* Currently no compression API exposed in browsers
* Help users suffering from poor upload bandwidth

## Usage

Regular `<script>` include ...

``` html
<script type="text/javascript" src="zpipe.min.js"></script>

<script>
	var deflated = zpipe.deflate("the balloon");

	var inflated = zpipe.inflate(deflated); // "the balloon"
</script>
```

With require() ...

``` js
var zpipe = require("zpipe");

var deflated = zpipe.deflate("the balloon");

var inflated = zpipe.inflate(deflated); // "the balloon"
```

## Installation

Install the package with **npm**.

    $ npm install zpipe

Alternatively just add it to your **Ender** packages.

    $ ender add zpipe

## But it's so big!

Ok 201 KB for `zpipe.min.js` is big, however it comes in at **57.6 KB** gzipped. This is acceptable.

## Tests

Test against node zlib:

    $ make test # Run the tests

Run the test in the browser by pointing your browser to `test/test.html`.

## Notes

* zpipe operates on octet strings only, UTF-16 characters will have their high byte masked.
* Only [browsers suporting TypedArrays](http://caniuse.com/typedarrays) will run zpipe.

## TODO

* Support stream compression through workers
* Benchmarks
