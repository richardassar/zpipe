var zpipe = require("../src/zpipe.js");

var data = "Experiments With Alternating Currents of Very High Frequency, and Their Application to Methods of Artificial Illumination";

var deflated = zpipe.deflate(data);

console.log(deflated, deflated.length);

var inflated = zpipe.inflate(deflated);

console.log(inflated, inflated.length);
