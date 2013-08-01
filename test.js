var HDR = require('./'),
	fs = require('fs');

var test = fs.createReadStream('./test/ennis.hdr');

var hdr = new HDR.loader();

hdr.on('load', function() {
	console.log(this.width, this.height, this.headers, this.comments, this.data.length);
});

test.pipe(hdr);