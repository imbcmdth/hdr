var stream = require('stream'),
    util = require('util'),
    colorUtil = require('./color');

module.exports = HDRLoader;

var MINLEN = 8,
    MAXLEN = 0x7fff,
    HEADER_REGEX = /([\#\?]+)?([^=\n\r]+)?=?([^=\n\r]*)?([\n\r]+)/gi,
    DIMENSION_REGEX = /([+\-])([XY])\s(\d+)\s([+\-])([XY])\s(\d+)/i,
    HEADER_PREFIXES = {
    	'#?': 'FILETYPE',
    	'#': 'COMMENT',
    	'undefined': 'HEADER'
    },
    R = 0,
    G = 1,
    B = 2,
    E = 3;

function HDRLoader (options) {
	if (!options) options = {};
	if (!options.highWaterMark) options.highWaterMark = 262144;

	stream.Writable.call(this, options);

	this.headers = {};
	this.comments = [];
	this.data = null;
	this.width = -1;
	this.height = -1;

	this._lastChunk = null;
	this._headerFinished = false;
	this._error = false;
	this._row_major = true;
	this._scanlineSize = -1;
}

util.inherits(HDRLoader, stream.Writable);

HDRLoader.prototype._write = function (chunk, encoding, next) {
	if (this._error) {
		return next();
	}

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

HDRLoader.prototype.end = function (chunk, encoding) {
	if (this._lastChunk) {
		if (chunk) this._lastChunk =  Buffer.concat([this._lastChunk, chunk]);

		while (this._lastChunk.length > 0) {
			this._readScanline(this._lastChunk);
		}
	}

	this.emit('load');
}
/*
HDRLoader.prototype._processChunk = function (next) {
	if (this._lastChunk.length >= this._scanlineSize) {
		this._readScanline(this._lastChunk);
		return setImmediate(this._processChunk.bind(this, next));
	} else {
		this._copyRemainingBuffer(this._lastChunk, 0);
		return next();
	}
}
*/
HDRLoader.prototype._readScanline = function (chunk) {
	var firstPixel = [],
	    scanline;

	firstPixel[R] = chunk.readUInt8(R);
	firstPixel[G] = chunk.readUInt8(G);
	firstPixel[B] = chunk.readUInt8(B);
	firstPixel[E] = chunk.readUInt8(E);

	if (this._isOldRLE(firstPixel)) {
		scanline = this._readOldRLE(chunk);
	} else {
		if ((firstPixel[B] << 8 | firstPixel[E]) !== this._getScanlinePixels()) {
			this._lastChunk = null;
			this.data = null;
			this._error = true;
			this.emit('error');
			return;
		}

		scanline = this._readNewRLE(chunk.slice(4))
	}

	if (this._row_major) {
		for (var i = this._start_x; i !== this._end_x; i += this._inc_x) {
			this._writePixel(i, this._current_y, colorUtil.toFloats.apply(null, scanline.shift()));
		}
		this._current_y += this._inc_y;
	} else {
		for (var i = this._start_y; i !== this._end_y; i += this._inc_y) {
			this._writePixel(this._current_x, i, colorUtil.toFloats.apply(null, scanline.shift()));
		}
		this._current_x += this._inc_x;
	}
}

HDRLoader.prototype._readOldRLE = function (chunk) {
	var scanline = [],
	    len = this._getScanlinePixels(),
	    offset = 0,
	    writePos = 0,
	    i, rshift = 0;

	while (len > 0) {
		scanline[writePos] = [];
		scanline[writePos][R] = chunk.readUInt8(offset++);
		scanline[writePos][G] = chunk.readUInt8(offset++);
		scanline[writePos][B] = chunk.readUInt8(offset++);
		scanline[writePos][E] = chunk.readUInt8(offset++);

		if (scanline[writePos][R] === 1 &&
			scanline[writePos][G] === 1 &&
			scanline[writePos][B] === 1) {
			for (i = scanline[writePos][E] << rshift; i > 0; i--) {
				scanline[writePos] = [];
				scanline[writePos][R] = scanline[writePos - 1][R];
				scanline[writePos][G] = scanline[writePos - 1][G];
				scanline[writePos][B] = scanline[writePos - 1][B];
				scanline[writePos][E] = scanline[writePos - 1][E];
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

HDRLoader.prototype._readNewRLE = function (chunk) {
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
				while (code--) {
					if (scanline[j] == null) scanline[j] = [];
					scanline[j++][i] = chunk.readUInt8(offset++);
				}
			}
		}
	}

	this._trimRemainingBuffer(chunk, offset);
	return scanline;
}

HDRLoader.prototype._copyRemainingBuffer = function (chunk, consumed) {
	var remainingLen = chunk.length - consumed;

	this._lastChunk = new Buffer(remainingLen);

	chunk.copy(this._lastChunk, 0, consumed);
//	this._lastChunk = chunk.slice(consumed);
}

HDRLoader.prototype._trimRemainingBuffer = function (chunk, consumed) {
	this._lastChunk = chunk.slice(consumed);
}

HDRLoader.prototype._writePixel = function (x, y, pixelData) {
	var offset = (x + y * this.width) * 3;

	this.data[offset++] = pixelData[R];
	this.data[offset++] = pixelData[G];
	this.data[offset++] = pixelData[B];
}

HDRLoader.prototype._readHeader = function (chunk) {
	var str = chunk.toString('ascii'),
	    sliceOffset = 0,
	    headerData;

	while (headerData = HEADER_REGEX.exec(str)) {
		sliceOffset += headerData[0].length;
		if (DIMENSION_REGEX.test(headerData[2])) {
			// Parse size header
			this._readSizeHeader(headerData[2]);

			if (!this.headers['RADIANCE']
				|| this.width <= 0
				|| this.height <= 0) {
				this.data = null;
				this._error = true;
				this.emit('error');
			}

			this._headerFinished = true;
			break;
		} else {
			switch (HEADER_PREFIXES[String(headerData[1])]) {
				case 'FILETYPE':
					if (headerData[2] === 'RADIANCE' || headerData[2] === 'RGBE') {
						this.headers['RADIANCE'] = true;
					}
					break;
				case 'HEADER':
					this.headers[headerData[2]] = this._processHeader(headerData[2], headerData[3]);
					break;
				case 'COMMENT':
					this.comments.push(headerData[2]);
					break;
				default:
					// Must be a parse error
					this._error = true;
					this.emit('error');
			}
		}
	}

	this._trimRemainingBuffer(chunk, sliceOffset);
}

HDRLoader.prototype._processHeader = function (headerName, headerValue) {
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

HDRLoader.prototype._isOldRLE = function (pixel) {
	var len = this._getScanlinePixels();

	if (len < MINLEN || len > MAXLEN) return true;

	if (pixel[R] !== 2) return true;

	if (pixel[G] !== 2 || pixel[B] & 128) return true;

	return false;
}

HDRLoader.prototype._getScanlinePixels = function() {
	if (this._row_major) {
		return this.width;
	} else {
		return this.height;
	}
}

HDRLoader.prototype._readSizeHeader = function(header) {
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