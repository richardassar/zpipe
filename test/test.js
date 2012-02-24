// TODO: Nodeunit

var zpipe = require("../src/zpipe.js");
var zlib = require("zlib");

var data = "Experiments With Alternating Currents of Very High Frequency, and Their Application to Methods of Artificial Illumination";

var zpipe_deflated = zpipe.deflate(data);

var zpipe_inflated = zpipe.inflate(zpipe_deflated);

var zlib_deflated, zlib_inflated;

var zlib_inflated_zpipe_deflated, zpipe_inflated_zlib_deflated;

zlib.deflate(data, function(err, buffer) {
	if(!err) {
		zlib_deflated = buffer.toString();

		zlib.inflate(buffer, function(err, buffer) {
			if(!err) {
				zlib_inflated = buffer.toString();

				zlib.inflate(zpipe_deflated, function(err, buffer) {
					if(!err) {
						zlib_inflated_zpipe_deflated = buffer.toString();

						zpipe_inflated_zlib_deflated = zpipe.inflate(zlib_deflated);
						
						showResults();
					} else { 
						throw err;
					}
				});
			} else {
				throw err;
			}
		});
	} else {
		throw err;
	}
});

var zlib_inflated = zlib.Inflate(zlib_inflated);

function showResults() {
	console.log("--------------------------------------------");
	console.log(zpipe_deflated, zpipe_deflated.length);
	console.log("--------------------------------------------");
	console.log(zpipe_inflated, zpipe_inflated.length);
	console.log("--------------------------------------------");
	console.log(zlib_deflated, zlib_deflated.length);
	console.log("--------------------------------------------");
	console.log(zlib_inflated, zlib_inflated.length);
	console.log("--------------------------------------------");
	console.log(zlib_inflated_zpipe_deflated, zlib_inflated_zpipe_deflated.length);
	console.log("--------------------------------------------");
	console.log(zpipe_inflated_zlib_deflated, zpipe_inflated_zlib_deflated.length);
	console.log("--------------------------------------------");
};
