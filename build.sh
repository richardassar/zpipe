#!/bin/sh
cat src/zpipe.js | java -jar ~/closure-compiler/compiler.jar > dist/zpipe.min.js
