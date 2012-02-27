all: dist/zpipe.min.js

dist/zpipe.min.js:
	cat src/zpipe.js | java -jar ~/closure-compiler/compiler.jar > dist/zpipe.min.js

clean:
	rm dist/zpipe.min.js

test:
	@./node_modules/.bin/mocha --reporter list

.PHONY: test clean
