function trunc (v) { return Math[v < 0 ? 'ceil' : 'floor'](v); }

var min = Math.min,
    max = Math.max,
    pow = Math.pow,
    log = Math.log,
    LN2 = Math.LN2,
    floor = Math.floor,
    expTable = Array.apply(null, new Array(256)).map(function (v, i) { return pow(2, i - (128 + 8));});

module.exports = {
	toFloats: function (r, g, b, e) {
		if (e === 0) return [0, 0, 0, 0];

		var m = expTable[e];

		return [(r + 0.5) / 256 * m, (g + 0.5) / 256 * m, (b + 0.5) / 256 * m];
	},
	fromFloats: function (r, g, b) {
		var v = max(r, g, b);

		if (v < 1e-38) return [0, 0, 0, 0];

		v = log(v) / LN2;

		var e = trunc(v) + 128,
		    m = expTable[e];

		return [floor(r * 255.9999 / m), floor(g * 255.9999 / m), floor(b * 255.9999 / m), e];
	}
};