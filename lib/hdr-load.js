var stream = require('stream'),
    util = require('util'),
    colorUtil = require('./color');

module.exports = HDRReader;

var MINLEN = 8,
    MAXLEN = 0x7fff,
    HEADER_REGEX = /([\#\?]+)?([^=\n\r]+)?=?([^=\n\r]*)?([\n\r]+)/gi,
    DIMENSION_REGEX = /([+\-])([XY])\s(\d+)\s([+\-])([XY])\s(\d+)/i,
    HEADER_PREFIXES = {
    	'#?': 'FILETYPE',
    	'#': 'COMMENT',
    	'undefined': 'HEADER'
    };

function HDRReader (options) {
	if (!options) options = {};
	if (!options.highWaterMark) options.highWaterMark = 65536;

	stream.Writable.call(this, options);

	this.headers = {};
	this.comments = [];
	this.data = null;
	this.width = 0;
	this.height = 0;

	this._lastChunk = null;
	this._headerFinished = false;
	this._startOfScanline = true;
	this._newRLEScanline = false;

	this._row_major = true;
	this._scanlineSize = 0;
}

util.inherits(HDRReader, stream.Writable);

HDRReader.prototype._write = function (chunk, encoding, next) {
	if (this._lastChunk) {
		this._lastChunk = Buffer.concat([this._lastChunk, chunk]);
	} else {
		this._lastChunk = chunk;
	}

	if (!this._headerFinished) {
		this._readHeader(this._lastChunk, encoding);
		return next();
	}

	while (this._lastChunk.length >= this._scanlineSize) {
//		this._processChunk(next);
		this._readScanline(this._lastChunk);
	}

//	this._copyRemainingBuffer(this._lastChunk, 0);

	return next();
}

HDRReader.prototype.end = function (chunk, encoding) {
	if (this._lastChunk) {
		if (chunk) this._lastChunk =  Buffer.concat([this._lastChunk, chunk]);

		while (this._lastChunk.length > 0) {
			this._readScanline(this._lastChunk);
		}
	}

	this.emit('load');
}
/*
HDRReader.prototype._processChunk = function (next) {
	if (this._lastChunk.length >= this._scanlineSize) {
		this._readScanline(this._lastChunk);
		return setImmediate(this._processChunk.bind(this, next));
	} else {
		this._copyRemainingBuffer(this._lastChunk, 0);
		return next();
	}
}
*/
HDRReader.prototype._readScanline = function (chunk) {
	var firstPixel = [],
	    scanline;

	firstPixel[0] = chunk.readUInt8(0);
	firstPixel[1] = chunk.readUInt8(1);
	firstPixel[2] = chunk.readUInt8(2);
	firstPixel[3] = chunk.readUInt8(3);

	if (this._isOldRLE(firstPixel)) {
		scanline = this._readOldRLE(chunk);
	} else {
		scanline = this._readNewRLE(chunk.slice(4))
	}

	firstPixel = null;

	if (this._row_major) {
		for (var i = this._start_x; i !== this._end_x; i += this._inc_x) {
			this._writePixel(i, this._current_y, colorUtil.toFloatArray.apply(null, scanline.shift()));
		}
		this._current_y += this._inc_y;
	} else {
		for (var i = this._start_y; i !== this._end_y; i += this._inc_y) {
			this._writePixel(this._current_x, i, colorUtil.toFloatArray.apply(null, scanline.shift()));
		}
		this._current_x += this._inc_x;
	}
}

HDRReader.prototype._readOldRLE = function (chunk) {
	var scanline = [],
	    len = this._getScanlinePixels(),
	    offset = 0,
	    writePos = 0,
	    i, rshift = 0;

	while (len > 0) {
		scanline[writePos] = [];
		scanline[writePos][0] = chunk.readUInt8(offset++);
		scanline[writePos][1] = chunk.readUInt8(offset++);
		scanline[writePos][2] = chunk.readUInt8(offset++);
		scanline[writePos][3] = chunk.readUInt8(offset++);

		if (scanline[writePos][0] === 1 &&
			scanline[writePos][1] === 1 &&
			scanline[writePos][2] === 1) {
			for (i = scanline[writePos][3] << rshift; i > 0; i--) {
				scanline[writePos] = [];
				scanline[writePos][0] = scanline[writePos - 1][0];
				scanline[writePos][1] = scanline[writePos - 1][1];
				scanline[writePos][2] = scanline[writePos - 1][2];
				scanline[writePos][3] = scanline[writePos - 1][3];
				writePos++;
				len--;
			}
			rshift += 8;
		}
		else {
			writePos++;
			len--;
			rshift = 0;
		}
	}

	this._trimRemainingBuffer(chunk, offset);
	return scanline;
}

HDRReader.prototype._readNewRLE = function (chunk) {
	var scanline = [],
	    offset = 0;

	for (var i = 0; i < 4; i++) {
		for (var j = 0; j < this._getScanlinePixels(); ) {
			var code = chunk.readUInt8(offset++);
			if (code > 128) { // run
				code &= 127;
				var val = chunk.readUInt8(offset++);
				while (code--) {
					if (scanline[j] == null) scanline[j] = [];
					scanline[j++][i] = val;
				}
			} else { // non-run
				while(code--) {
					if (scanline[j] == null) scanline[j] = [];
					scanline[j++][i] = chunk.readUInt8(offset++);
				}
			}
		}
	}

	this._trimRemainingBuffer(chunk, offset);
	return scanline;
}

HDRReader.prototype._copyRemainingBuffer = function (chunk, consumed) {
	var remainingLen = chunk.length - consumed;

	this._lastChunk = new Buffer(remainingLen);

	chunk.copy(this._lastChunk, 0, consumed);
//	this._lastChunk = chunk.slice(consumed);
}

HDRReader.prototype._trimRemainingBuffer = function (chunk, consumed) {
	this._lastChunk = chunk.slice(consumed);
}

HDRReader.prototype._writePixel = function (x, y, pixelData) {
	var offset = (x + y * this.width) * 3;

	this.data[offset++] = pixelData[0];
	this.data[offset++] = pixelData[1];
	this.data[offset++] = pixelData[2];
}

HDRReader.prototype._readHeader = function (chunk) {
	var str = chunk.toString('ascii'),
	    sliceOffset = 0,
	    headerData;

	while (headerData = HEADER_REGEX.exec(str)) {
		sliceOffset += headerData[0].length;
		if (DIMENSION_REGEX.test(headerData[2])) {
			// Parse size header
			this._readSizeHeader(headerData[2]);
			this._headerFinished = true;
			break;
		} else {
			switch (HEADER_PREFIXES[String(headerData[1])]) {
				case 'FILETYPE':
					this.headers['RADIANCE'] = true;
					break;
				case 'HEADER':
					this.headers[headerData[2]] = this._processHeader(headerData[2], headerData[3]);
					break;
				case 'COMMENT':
					this.comments.push(headerData[2]);
					break;
				default:
			}
		}
	}

	this._trimRemainingBuffer(chunk, sliceOffset);
}

HDRReader.prototype._processHeader = function (headerName, headerValue) {
	switch (headerName.toUpperCase()) {
		case 'EXPOSURE':
			var val = parseFloat(headerValue);
			return ('EXPOSURE' in this.headers) ? this.headers['EXPOSURE'] * val : val;
		case 'COLORCORR':
			var vals = headerValue.split(/\s+/);
			vals = vals.map(parseFloat);
			return ('COLORCORR' in this.headers) ? this.headers['COLORCORR'].map(mults(vals)) : vals;
		default:
			return headerValue;
	}
}

HDRReader.prototype._isOldRLE = function (pixel) {
	var len = this._getScanlinePixels();

	if (len < MINLEN || len > MAXLEN) return true;

	if (pixel[0] !== 2) return true;

	if (pixel[1] !== 2 || pixel[2] & 128) return true;

	return false;
}

HDRReader.prototype._getScanlinePixels = function() {
	if (this._row_major) {
		return this.width;
	} else {
		return this.height;
	}
}

HDRReader.prototype._readSizeHeader = function(header) {
	var sizeData = header.match(DIMENSION_REGEX);

	if (sizeData[2].toLowerCase() === "y") {
		this._row_major = true;

		this.height = +sizeData[3];
		if (sizeData[1] === '-') {
			this._start_y = 0;
			this._end_y = this.height;
			this._inc_y = 1;
			this._current_y = this._start_y;
		} else {
			this._start_y = this.height - 1;
			this._end_y = -1;
			this._inc_y = -1;
			this._current_y = this._start_y;
		}

		this.width = +sizeData[6];
		if (sizeData[4] === '-') {
			this._start_x = this.width - 1;
			this._end_x = -1;
			this._inc_x = -1;
			this._current_x = this._start_x;
		} else {
			this._start_x = 0;
			this._end_x = this.width;
			this._inc_x = 1;
			this._current_x = this._start_x;
		}
	} else {
		this._row_major = false;

		this.width = +sizeData[3];
		if (sizeData[1] === '-') {
			this._start_x = 0;
			this._end_x = this.width;
			this._inc_x = 1;
			this._current_y = this._start_y;
		} else {
			this._start_x = this.width - 1;
			this._end_x = -1;
			this._inc_x = -1;
			this._current_x = this._start_x;
		}

		this.height = +sizeData[6];
		if (sizeData[4] === '-') {
			this._start_y = this.height - 1;
			this._end_y = -1;
			this._inc_y = -1;
			this._current_y = this._start_y;
		} else {
			this._start_y = 0;
			this._end_y = this.height;
			this._inc_y = 1;
			this._current_x = this._start_x;
		}
	}

	this.data = new Float32Array(this.width * this.height * 3);
	this._scanlineSize = this._getScanlinePixels() * 4 + 4; // Number of pixels + possible special pixel at beginning
}

function mults (m) {
	return function (v, i) {
		return m[i] * v;
	};
}