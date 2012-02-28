all: dist/zpipe.min.js dist/zpipe.native.min.js

dist:
	mkdir -p dist

dist/zpipe.min.js: dist src/zpipe.js
	cat src/header.js src/zpipe.js src/footer.js | java -jar ~/closure-compiler/compiler.jar > dist/zpipe.min.js

dist/zpipe.native.min.js: dist src/zpipe.native.js
	cat src/header.js src/zpipe.native.js src/footer.js | java -jar ~/closure-compiler/compiler.jar > dist/zpipe.native.min.js

clean:
	rm -rf dist

test: dist/zpipe.min.js dist/zpipe.native.min.js
	@./node_modules/.bin/mocha --reporter list

.PHONY: test clean
