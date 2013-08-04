# HDR

A minimal streaming HDR image (ie. Radiance .pic format) library for node.js.

## Contents

* [Installation](#install)

* [Basic Usage](#basic-usage)

* [Versions](#versions)

* [License](#license---mit)

## Install

````bash
npm install hdr
````

..then `require` hdr:

````javascript
var HDR = require('hdr');
````

## Basic Usage

```javascript
var HDR = require('hdr'),
    fs = require('fs'),
    file = fs.createReadStream('image.hdr');

//-- Create a new loader:
var hdrloader = new HDR.loader();

//-- Load event is triggered once all the data has been read from the file:
hdrloader.on('load', function() {
	//-- this.headers  - object with header names as keys
	//--                 (header 'RADIANCE' should always be true)
	//-- this.comments - array with any comment headers
	//
	//-- this.width    - image width in pixels
	//-- this.height   - image height in pixels
	//-- this.data     - Float32Array of pixel colors with length = width*height*3
	//--                 in non-planar [R, G, B, R, G, B, ...] pixel layout
});

//-- Start piping in image data from filesystem/http request/ect.:
file.pipe(hdrloader);

```

This library does the minimum required to read HDR files. It is up to the consumer of the data to convert between XYZ and RGB, if desired, and to apply any corrections specified by `EXPOSURE`, `PRIMARIES`, or `COLORCORR` headers.

## Versions

* [v0.5.0](https://github.com/imbcmdth/hdr/archive/v1.0.0.zip) Initial public release

## License - MIT

> Copyright (C) 2013 Jon-Carlos Rivera
> 
> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
