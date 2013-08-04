var HDR = require('../'),
	fs = require('fs');

var testRGB = fs.createReadStream('../test/rgba.hdr');
var testXYZ = fs.createReadStream('../test/xyze.hdr');

var hdrRGB = new HDR.loader();
var hdrXYZ = new HDR.loader();

hdrRGB.on('load', loaded);
hdrXYZ.on('load', loaded);

testRGB.pipe(hdrRGB);
testXYZ.pipe(hdrXYZ);

function loaded() {
	console.log(this.width, this.height, this.headers, this.comments, this.data.length);
}