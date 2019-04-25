function createShader(gl, shaderSource, shaderType) {
    var shader = gl.createShader(shaderType);

    // Load the shader source
    gl.shaderSource(shader, shaderSource);

    // Compile the shader
    gl.compileShader(shader);

    // Check the compile status
    var compiled = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
    if (!compiled) {
      // Something went wrong during compilation; get the error
      // var lastError = gl.getShaderInfoLog(shader);
      // errFn("*** Error compiling shader '" + shader + "':" + lastError);
      gl.deleteShader(shader);
      return null;
    }

    return shader;
};

var GPUFilterManager = function() {
	this.filters = [];

	this.canvas = document.createElement("canvas");

	this.vertexShaderCode = `attribute vec2 a_position;
	attribute vec2 a_texCoord;

	uniform vec2 u_resolution;
	uniform float u_flipY;

	varying vec2 v_texCoord;

	void main() {
	   // convert the rectangle from pixels to 0.0 to 1.0
	   vec2 zeroToOne = a_position / u_resolution;

	   // convert from 0->1 to 0->2
	   vec2 zeroToTwo = zeroToOne * 2.0;

	   // convert from 0->2 to -1->+1 (clipspace)
	   vec2 clipSpace = zeroToTwo - 1.0;

	   gl_Position = vec4(clipSpace * vec2(1, u_flipY), 0, 1);

	   // pass the texCoord to the fragment shader
	   // The GPU will interpolate this value between points.
	   v_texCoord = a_texCoord;
	}`;

	this.processImage = function(image) {

		var width = image.width;
		var height = image.height;

		if (!this.canvas) {
			this.canvas = document.createElement("canvas");
		}

		if (this.canvas.width != width || this.canvas.height != height) {
			this.canvas.width = width;
			this.canvas.height = height;
		}

		// var ctx = this.canvas.getContext('2d');
		// ctx.drawImage(image,0,0,width,height);

		var gl = this.gl;
		if (!gl) {
			gl = this.canvas.getContext("webgl"/*,{preserveDrawingBuffer: true}*/);
			this.gl = gl;
		}

		var vertex = this.vertex
		if (!vertex) {
			vertex = createShader(gl,this.vertexShaderCode, gl.VERTEX_SHADER);
		}
		this.vertex = vertex;

	    // Clear the canvas
	    gl.clearColor(0, 0.0, 0, 0.0);
	    gl.clear(gl.COLOR_BUFFER_BIT);

		// Create a buffer to put three 2d clip space points in
		var positionBuffer = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);

		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
			0, 0,
			width, 0,
			0, height,
			0, height,
			width, 0,
			width, height,
		]), gl.STATIC_DRAW);

		// provide texture coordinates for the rectangle.
		var texcoordBuffer = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, texcoordBuffer);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
		  0.0,  0.0,
		  1.0,  0.0,
		  0.0,  1.0,
		  0.0,  1.0,
		  1.0,  0.0,
		  1.0,  1.0,
		]), gl.STATIC_DRAW);

		function createAndSetupTexture(gl) {
			var texture = gl.createTexture();
			gl.bindTexture(gl.TEXTURE_2D, texture);

			// Set up texture so we can render any size image and so we are
			// working with pixels.
			// gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
			// gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
			// gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.Linear);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
			return texture;
		}

		var originalImageTexture = createAndSetupTexture(gl);
		// originalImageTexture.image = image;
		// gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);

		// create 2 textures and attach them to framebuffers.
		var textures = [];
		var framebuffers = [];
		for (var ii = 0; ii < 2; ++ii) {
			var texture = createAndSetupTexture(gl);
			textures.push(texture);

			// make the texture the same size as the image
			gl.texImage2D(
			    gl.TEXTURE_2D, 0, gl.RGBA, image.width, image.height, 0,
			    gl.RGBA, gl.UNSIGNED_BYTE, null);

			// Create a framebuffer
			var fbo = gl.createFramebuffer();
			framebuffers.push(fbo);
			gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);

			// Attach a texture to it.
			gl.framebufferTexture2D(
			    gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
		}

		// Bind the position buffer.
		gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);

		// start with the original image
		gl.bindTexture(gl.TEXTURE_2D, originalImageTexture);

		var filters = this.filters.slice(0);

		var count = 0;
		for (var i = 0; i < filters.length; i++) {
			var filter = filters[i];
			var program = filter.createProgram(gl,vertex);

			drawWithProgram(gl, program, framebuffers[count % 2], width, height, positionBuffer, texcoordBuffer, 1);
	        gl.bindTexture(gl.TEXTURE_2D, textures[count % 2]);
			// increment count so we use the other texture next time.
			++count;
		}

		// drawWithProgram(gl, normalFilter.createProgram(gl, vertex), null, width, height, positionBuffer, texcoordBuffer, -1);

		let finalWidth = gl.drawingBufferWidth;
		let finalHeight = gl.drawingBufferHeight;

		var pixels = new Uint8Array(finalWidth * finalHeight * 4);
		gl.readPixels(0, 0, finalWidth, finalHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
		// var src = this.canvas.toDataURL()
		// var holder = document.getElementById("holder");
		// if(this.canvas.parentNode != holder) {
		// 	holder.appendChild(this.canvas);
		// }
		// var imageTag = document.createElement("img");
		// imageTag.src = src;
		// var holder = document.getElementById("imageHolder");
		// holder.innerHTML = ""
		// holder.appendChild(imageTag);

		for (var i = 0; i < framebuffers.length; i++) {
			gl.deleteFramebuffer(framebuffers[i]);
		}

		for (var i = 0; i < textures.length; i++) {
			gl.deleteTexture(textures[i]);
		}

		gl.deleteTexture(originalImageTexture);

		gl.deleteBuffer(positionBuffer);

		gl.deleteBuffer(texcoordBuffer);

		let imageData = new ImageData(finalWidth, finalHeight);
		imageData.data.set(pixels);

		return imageData;
	}

	function drawWithProgram(gl, program, framebuffer, width, height, positionBuffer, texcoordBuffer, flipY) {
		// Tell it to use our program (pair of shaders)
			gl.useProgram(program);

			var positionLocation = gl.getAttribLocation(program, "a_position");
			var texcoordLocation = gl.getAttribLocation(program, "a_texCoord");
			var resolutionLocation = gl.getUniformLocation(program, "u_resolution");
			var textureSizeLocation = gl.getUniformLocation(program, "u_textureSize");
			var flipYLocation = gl.getUniformLocation(program, "u_flipY");

		    // Turn on the position attribute
		    gl.enableVertexAttribArray(positionLocation);

	        // Bind the position buffer.
		    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);

	        // Tell the position attribute how to get data out of positionBuffer (ARRAY_BUFFER)
			var size = 2;          // 2 components per iteration
			var type = gl.FLOAT;   // the data is 32bit floats
			var normalize = false; // don't normalize the data
			var stride = 0;        // 0 = move forward size * sizeof(type) each iteration to get the next position
			var offset = 0;        // start at the beginning of the buffer
			gl.vertexAttribPointer(
			positionLocation, size, type, normalize, stride, offset)

		    // Turn on the teccord attribute
			gl.enableVertexAttribArray(texcoordLocation);

			// Bind the position buffer.
			gl.bindBuffer(gl.ARRAY_BUFFER, texcoordBuffer);

			// Tell the position attribute how to get data out of positionBuffer (ARRAY_BUFFER)
			var size = 2;          // 2 components per iteration
			var type = gl.FLOAT;   // the data is 32bit floats
			var normalize = false; // don't normalize the data
			var stride = 0;        // 0 = move forward size * sizeof(type) each iteration to get the next position
			var offset = 0;        // start at the beginning of the buffer
			gl.vertexAttribPointer(
			    texcoordLocation, size, type, normalize, stride, offset);

			// set the size of the image
			gl.uniform2f(textureSizeLocation, width, height);

			// don't y flip images while drawing to the textures
			gl.uniform1f(flipYLocation, flipY);

			// make this the framebuffer we are rendering to.
			gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);

			// Tell the shader the resolution of the framebuffer.
			gl.uniform2f(resolutionLocation, width, height);

			// Tell webgl the viewport setting needed for framebuffer.
			gl.viewport(0, 0, width, height);

			// Draw the rectangle.
			var primitiveType = gl.TRIANGLES;
			var offset = 0;
			var count = 6;
			gl.drawArrays(primitiveType, offset, count);
			// gl.deleteProgram(program);
	}

}

var GPUFilter = function(fragmentShader) {
	this.fragmentShader = fragmentShader;

	this.storedProgram = null;

	this.createProgram = function(gl,vertex) {
		if (this.storedProgram) {
			var linked = gl.getProgramParameter(this.storedProgram, gl.LINK_STATUS);
			if (linked) {
				return this.storedProgram;
			}
			gl.deleteProgram(this.storedProgram);
			delete this.storedProgram;
		}
		var program = gl.createProgram();
		var frag = createShader(gl,this.fragmentShader, gl.FRAGMENT_SHADER);

		if (!frag || !vertex) {
			return null;
		}

		var shaders = [vertex, frag];

		shaders.forEach(function(shader) {
	      gl.attachShader(program, shader);
	    });
		gl.linkProgram(program);

	    // Check the link status
	    var linked = gl.getProgramParameter(program, gl.LINK_STATUS);
	    if (!linked) {
	        // something went wrong with the link
	        // var lastError = gl.getProgramInfoLog(program);
	        // errFn("Error in program linking:" + lastError);

	        gl.deleteProgram(program);
	        return null;
	    }
	    this.storedProgram = program;
	    return program;
	};
};

class GPUAutomat {
	constructor(size, comparatorCode) {
		this.size = size;
		this.imageData = new ImageData(size, size)
		this.nullData = 0xFF808080;
		this.comparatorCode = comparatorCode;

		this.comparatorFilter = new GPUFilter(comparatorCode);

		this.manager = new GPUFilterManager();
		this.manager.filters = [this.comparatorFilter];

		this.randomize();
	}

	tick() {
		let newData = this.manager.processImage(this.imageData)
		this.imageData = newData
	}

	randomize() {
		let size = this.size;
		for (var i = 0; i < (size * size); i++) {
			this.imageData.data[i * 4 + 0] = Math.floor(Math.random() * 256);
			this.imageData.data[i * 4 + 1] = Math.floor(Math.random() * 256);
			this.imageData.data[i * 4 + 2] = Math.floor(Math.random() * 256);
		}
	}

	render() {
		return this.imageData;
	}
}
