var expTable = Array.apply(null, new Array(256)).map(function (v,i) { return Math.pow(2, i - 128);});

module.exports = {
	toFloatArray: function(r, g, b, e) {
		if (e === 0) return [0, 0, 0, 0];

		var m = expTable[e];

		return [r / 256 * m, g / 256 * m, b / 256 * m];
	}
};