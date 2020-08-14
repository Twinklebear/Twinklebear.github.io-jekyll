---
layout: post
title: "From 0 to glTF with WebGPU: The First Triangle"
description: ""
category: graphics
tags: [graphics, webgpu]
published: true
---
{% include JB/setup %}

{% assign figurecount = 0 %}

WebGPU is a modern graphics API for the web, in development by the
major browser vendors. When compared to WebGL, WebGPU provides more direct
control over the GPU to allow applications to leverage the hardware
more efficiently, similar to Vulkan and DirectX 12.
WebGPU also exposes additional GPU capabilities not available in WebGL, such as compute
shaders and storage buffers, enabling powerful GPU compute applications
to run on the web. As with the switch from OpenGL to Vulkan, WebGPU
exposes more complexity to the user than WebGL, though the API strikes
a good balance between complexity and usability, and overall is quite nice to work with.
In this series, we'll learn the key aspects of WebGPU from the ground up,
with the goal of going from zero to a basic glTF model renderer.
This post marks our initial step on this journey, where we'll setup
a WebGPU context and get a triangle on the screen.

<!--more-->

# Getting a WebGPU Context

The first step to working with WebGPU is to setup a browser
with it enabled. Chrome, Firefox, and Safari's implementations
are [still in progress](https://github.com/gpuweb/gpuweb/wiki/Implementation-Status),
and as such we need to use the corresponding nightly
browsers provided by the vendors. At the time of writing, I've found that
[Chrome Canary](https://www.google.com/chrome/canary/)
has the most complete implementation, and recommend using it for
development.
You'll also need to enable the WebGPU feature
in the nightly browser, following the [guides here](https://github.com/gpuweb/gpuweb/wiki/Implementation-Status).
Since browser support is still in progress, you'll want to disable
WebGPU during regular web browsing.
You can check if you've got WebGPU enabled by jumping to the bottom of this
post, where you should see the triangle we're going to be rendering. If
WebGPU isn't enabled, you'll see an error message instead.

The triangle renderer we'll implement in this post will work
in both Chrome Canary and Firefox Nightly; however, the WebGPU
implementation in Safari Technology Preview looks to possibly be on an older
version of the spec, and has some differences in default parameters
and the vertex buffer specificiation APIs. Thus, the code we discuss here
will not work in Safari for now, but can be made to work with some smaller tweaks.

The initial setup of our WebGPU rendering context is similar to WebGL.
Our webpage will have a canvas to display our rendered image,
and load our rendering code from `render.js`.

{% highlight html %}
<!DOCTYPE html>
<html>
<head>
    <title>WebGPU</title>
</head>
<body>
    <!-- The canvas to display our renderer output on -->
    <canvas id="webgpu-canvas" width="640" height="480"></canvas>
    <script src="render.js"></script>
</body>
</html>
{% endhighlight %}

A number of the APIs used to interact with the GPU are `async`, thus
we'll place our rendering code inside an `async`
function which is executed when the script is loaded.
Our first step is to get a [`GPUAdapter`](https://gpuweb.github.io/gpuweb/#adapter)
from the WebGPU API. Each adapter represents a GPU on the machine
and the browser's implementation of WebGPU on top of that GPU.
We can then request a [`GPUDevice`](https://gpuweb.github.io/gpuweb/#devices)
from the adapter, which gives us a context to work with the hardware.
The `GPUDevice` provides APIs to create GPU objects such as buffers and textures, and
execute commands on the device. The distinction between the `GPUAdapter`
and `GPUDevice` is similar to that of `VkPhysicalDevice` and `VkDevice` in Vulkan.
As with WebGL, we need a context for the canvas which will
be used to display our rendered image. To use WebGPU with the
canvas, we request a `gpupresent` context (Safari calls it a `gpu` context).
After this setup, we can load our shaders and vertex
data, configure our render targets, and build our render pipeline, to draw
our triangle!

{% highlight js %}
(async () => {
    if (!navigator.gpu) {
        alert("WebGPU is not supported/enabled in your browser");
        return;
    }

    // Get a GPU device to render with
    var adapter = await navigator.gpu.requestAdapter();
    var device = await adapter.requestDevice();

    // Get a context to display our rendered image on the canvas
    var canvas = document.getElementById("webgpu-canvas");
    var context = canvas.getContext("gpupresent");

    // Setup shader modules
    // ....

    // Specify vertex data
    // ....

    // Setup render outputs
    // ....

    // Create render pipeline
    // ....

    // Render!
    // ....
})();
{% endhighlight %}

# The WebGPU Rendering Pipeline

The WebGPU rendering pipeline consists of two programmable stages: the
vertex shader and the fragment shader, similar to WebGL.
WebGPU also adds support for compute shaders, which exist outside
the rendering pipeline.

<figure>
	<img class="img-fluid"
		src="/assets/img/webgl-volumes/webgl-triangle-pipeline.svg"/>
	{% assign figurecount = figurecount | plus: 1 %}
	<figcaption><b>Figure {{figurecount}}:</b>
	<i>The rendering pipeline in WebGPU consists of two programmable shader stages:
	the vertex shader, responsible for transforming input
	vertices into clip space, and the fragment shader, responsible
	for shading the pixels covered by each triangle.
	</i></figcaption>
</figure>

To render our triangle, we'll need to configure such a pipeline,
specifying our shaders, vertex attribute configuration, etc.
In WebGPU, this pipeline takes the form of a concrete object, the
[`GPURenderPipeline`](https://gpuweb.github.io/gpuweb/#gpurenderpipeline),
which specifies the different pieces of the pipeline.
The configuration of the components of this pipeline (e.g., the shaders,
vertex state, render output state, etc.) are fixed, allowing the GPU
to better optimize rendering for the pipeline. The buffers
or textures bound to the corresponding inputs or outputs can be changed;
however, the number of inputs and outputs, and their types, etc. cannot be changed.
This is in contrast to WebGL, where the pipeline state for a draw
is implicitly specified through modifying a global state machine,
and the shaders, vertex state, etc., can be swapped out at any time
between draw calls, making it challenging to optimize the pipeline.

## Shader Modules

Our first step in creating the pipeline is to create the vertex and fragment
[shader modules](https://gpuweb.github.io/gpuweb/#shader-modules),
which will be executed in the pipeline.
WebGPU takes shaders in the form of SPV bytecode, which can either
be compiled from GLSL in the browser by shipping a GLSL compiler with
your application, or compiled to SPV bytecode ahead of time and fetched
from the server or embedded in the application code.
We'll take the embedded route, and use the `glslc` compiler
provided with the Vulkan SDK to compile our GLSL shaders to SPV.

The GLSL shaders for rendering our triangle are shown below.
Our vertex shader will take two inputs: the triangle position
and a color, and pass this color to the fragment shader.
The fragment shader will take this color as an input and write
it out to the first render target.

{% highlight glsl %}
// Vertex shader
#version 450 core

// Inputs: position and color
layout(location = 0) in vec4 pos;
layout(location = 1) in vec4 vcolor;

// Outputs: color passed to fragment shader
layout(location = 0) out vec4 fcolor;

void main(void) {
    fcolor = vcolor;
    gl_Position = pos;
}
{% endhighlight %}

{% highlight glsl %}
// Fragment shader
#version 450 core

// Input: fragment color
layout(location = 0) in vec4 fcolor;

// Output: fragment color
layout(location = 0) out vec4 color;

void main(void) {
    color = fcolor;
}
{% endhighlight %}

To embed our SPV bytecode JavaScript, we'll use the same approach for
embedding it in C or C++ programs. We compile the shaders
to SPV using `glslc` and output the bytecode as a C array (`-mfmt=c`).
The compiler will output our shader as an array of uint32's
which can be embedded into the program as an array variable.
In JavaScript, we can embed this array as a `Uint32Array` variable.
The shader compilation and output as an embedded `Uint32Array`
is performed by the Python script below.
First, the shader is compiled to SPV and output to `a.spv`,
using the C array output format.
The script then reads the array in this file and
generates a JS snippet to create a `Uint32Array` containing the
bytecode and writes it to stdout.

{% highlight python %}
#!/usr/bin/env python3

import sys
import os
import subprocess

if len(sys.argv) < 4:
    print("Usage <glslc> <shader> <var_name> [glslc_args...]")
    sys.exit(1)

glslc = sys.argv[1]
shader = sys.argv[2]
var_name = sys.argv[3]

compiled_shader = ""
args = [glslc, shader, "-mfmt=c"]
if len(sys.argv) > 4:
    args.extend(sys.argv[4:])

subprocess.check_output(args)
with open("a.spv", "r") as f:
    compiled_code = f.read()
    compiled_shader = "const " + var_name + " = new Uint32Array([" + compiled_code[1:-2] + "]);\n"

os.remove("a.spv")
print(compiled_shader)
{% endhighlight %}

To compile a shader you can run the script and pass the glslc compiler, your shader,
and the variable name to use for the array. The compiled shader bytecode array will
be printed to the console.

{% highlight bash %}
python3 ./compile_shader.py glslc.exe ./triangle.vert triangle_vert_spv
{% endhighlight %}

We can then paste the embedded SPV arrays into our code
and use them to create shader modules.
A shader module is created by calling `createShaderModule` on
our `GPUDevice`. The method takes an object containing
the parameters, and expects that the `code` member of the object
refers to our desired SPV bytecode.
Each shader module will be used in the pipeline as part of a
[`GPUProgrammableStageDescriptor`](https://gpuweb.github.io/gpuweb/#dictdef-gpuprogrammablestagedescriptor),
which specifies a shader module and entry point function
to call in the shader.

{% highlight js %}
// Setup shader modules

// Embedded SPV bytecode for our shaders
const triangle_vert_spv = new Uint32Array([/* .... */]);
const triangle_frag_spv = new Uint32Array([/* .... */]);

var vertModule = device.createShaderModule({code: triangle_vert_spv});
var vertexStage =  {
    module: vertModule,
    entryPoint: "main"
};

var fragModule = device.createShaderModule({code: triangle_frag_spv});
var fragmentStage =  {
    module: fragModule,
    entryPoint: "main"
};
{% endhighlight %}

Although embedding the shader bytecode is convenient,
if many variants of the shader need to be compiled and embedded (e.g., to handle different
model properties or material configurations), embedding them all can significantly
increase your application download size. In this case, it would be better to store the
different compiled variants separately on the server and fetch
them as needed using additional web requests.

## Specifying Vertex Data

Next, we'll specify the vertex data for our triangle.
We'll specify both the vertex positions and colors in a single
buffer, with the positions and colors interleaved with each other.
Each position and color will be stored as a `float4`.
First, we allocate and map a buffer on the device with enough
room to store the vertex data, using `createBufferMapped`.
This method takes the size (in bytes) of the buffer we want
to create and a set of flags or'd together specifying the
desired [usage modes](https://gpuweb.github.io/gpuweb/#buffer-usage) of the buffer.

`createBufferMapped` returns the `GPUBuffer` and an `ArrayBuffer` which
we can use to upload data into the buffer.
To write our vertex data we create a `Float32Array` view of the array buffer
and set the data through this view.
Finally, we have to unmap the buffer before using it later in rendering.

{% highlight js %}
// Specify vertex data
// Allocate room for the vertex data: 3 vertices, each with 2 float4's
var [dataBuf, dataBufMapping] = device.createBufferMapped({
    size: 3 * 2 * 4 * 4,
    usage: GPUBufferUsage.VERTEX
});

// Interleaved positions and colors
new Float32Array(dataBufMapping).set([
    1, -1, 0, 1,  // position
    1, 0, 0, 1,   // color
    -1, -1, 0, 1, // position
    0, 1, 0, 1,   // color
    0, 1, 0, 1,   // position
    0, 0, 1, 1,   // color
]);
dataBuf.unmap();
{% endhighlight %}

In the rendering pipeline, we'll specify an array of
[`GPUVertexBufferLayoutDescriptor`](https://gpuweb.github.io/gpuweb/#dictdef-gpuvertexbufferlayoutdescriptor)
objects, describing the input buffers containing vertex data and the
attributes within them. The attributes are described with an
array of [`GPUVertexAttributeDescriptor`](https://gpuweb.github.io/gpuweb/#dictdef-gpuvertexattributedescriptor)
objects set on each buffer descriptor.
This array is passed as the `vertexBuffers`
member of the [`GPUVertexStateDescriptor`](https://gpuweb.github.io/gpuweb/#dictdef-gpuvertexstatedescriptor)
object.
In this example, we have a single buffer containing the interleaved
attributes of each vertex. Thus, the stride between elements is 32 bytes (2 `float4`),
and the buffer specifies two `float4` attributes.
The first attribute is the position, and is sent to shader input location 0.
The second is the color, and is sent to shader input location 1.

WebGPU's model for specifying vertex buffers and attributes follows that of D3D12 and Vulkan,
where vertex buffers are bound to input slots and provide some set of vertex attributes,
illustrated below.
From a D3D12 view, the `vertexBuffers` member maps to the array of [`D3D12_INPUT_ELEMENT_DESC`](https://docs.microsoft.com/en-us/windows/win32/api/d3d12/ns-d3d12-d3d12_input_element_desc)
structures passed through the [`D3D12_INPUT_LAYOUT_DESC`](https://docs.microsoft.com/en-us/windows/win32/api/d3d12/ns-d3d12-d3d12_input_layout_desc)
when creating a graphics pipeline.
From a Vulkan view, the `vertexBuffers` member maps directly to the
[`VkPipelineVertexInputStateCreateInfo`](https://www.khronos.org/registry/vulkan/specs/1.2-extensions/man/html/VkPipelineVertexInputStateCreateInfo.html)
structure passed when creating a graphics pipeline.

<figure>
	<img class="img-fluid"
		src="/assets/img/webgpu-ia-slots.svg"/>
	{% assign figurecount = figurecount | plus: 1 %}
	<figcaption><b>Figure {{figurecount}}:</b>
	<i>Providing vertex attributes for our triangle to the input assembler through buffers.
    Our attributes are read from the buffer bound to input slot 0 and passed to the
    specified shader input locations, using the strides and offsets specified for
    the input slot and attributes.
	</i></figcaption>
</figure>

{% highlight js %}
// Specify vertex buffer input slots and the attributes provided by those buffers
var vertexState = {
    vertexBuffers: [
        {
            arrayStride: 2 * 4 * 4,
            attributes: [
                {
                    format: "float4",
                    offset: 0,
                    shaderLocation: 0
                },
                {
                    format: "float4",
                    offset: 4 * 4,
                    shaderLocation: 1
                }
            ]
        }
    ]
};
{% endhighlight %}

## Writing Rendering Outputs

Next we'll create a swap chain and specify where the results output from our fragment
shader should be written.
To display the images on our canvas, we need a swap chain associated with its context.
The swap chain will let us rotate through the images being displayed on the canvas,
rendering to a buffer which is not visible while another is shown (i.e., double-buffering).
We create a swap chain by specifying the desired image format and texture usage.
The swap chain will create one or more textures for us, sized to match the canvas
they'll be displayed on.
Since we'll be rendering directly to the swap chain textures, we specify that
they'll be used as output attachments.

{% highlight js %}
// Setup render outputs
var swapChainFormat = "bgra8unorm";
var swapChain = context.configureSwapChain({
    device: device,
    format: swapChainFormat,
    usage: GPUTextureUsage.OUTPUT_ATTACHMENT
});
{% endhighlight %}

Although in this example we're just drawing a single triangle, we'll
still create and use a depth texture since we'll need it later on.
The depth texture is created as a regular texture, specifying
the size, format, and usage. As before, we'll be rendering
directly to this texture and thus specify it will be used as
an output attachment.

{% highlight js %}
var depthFormat = "depth24plus-stencil8";
var depthTexture = device.createTexture({
    size: {
        width: canvas.width,
        height: canvas.height,
        depth: 1
    },
    format: depthFormat,
    usage: GPUTextureUsage.OUTPUT_ATTACHMENT
});
{% endhighlight %}

## Creating the Rendering Pipeline

Finally, we can create the rendering pipeline that combines our
shaders, vertex attributes, and output configuration, which we can
use to render our triangle. The rendering pipeline description is
passed through a [`GPURenderPipelineDescriptor`](https://gpuweb.github.io/gpuweb/#dictdef-gpurenderpipelinedescriptor)
object, passed to `createRenderPipeline`.
The final pieces required to create the rendering pipeline are
the pipeline layout, which specifies the bind group layouts used by the pipeline;
and the color and depth states, specifying the configuration used
to write the shader outputs.
We won't need bind groups in this example, so we can make a
pipeline layout which specifies that no bind groups will be used.

The color states behave similar to the input assembler's input slots.
We specify an array of [`GPUColorStateDescriptor`](https://gpuweb.github.io/gpuweb/#dictdef-gpucolorstatedescriptor),
which describe the set of output slots and texture format that will
be bound to them. During rendering, we attach textures to these slots
to write shader outputs to them. Our fragment shader has a single output slot
for the color data, which we'll write directly to the swap chain
image. Thus, we specify a single color state for an image with the swap
chain format. We'll also use our depth buffer, and specify the depth state
describing how the depth buffer should be used.

{% highlight js %}
// Create render pipeline
var layout = device.createPipelineLayout({bindGroupLayouts: []});

var renderPipeline = device.createRenderPipeline({
    layout: layout,
    vertexStage: vertexStage,
    fragmentStage: fragmentStage,
    primitiveTopology: "triangle-list",
    vertexState: vertexState,
    colorStates: [{
        format: swapChainFormat
    }],
    depthStencilState: {
        format: depthFormat,
        depthWriteEnabled: true,
        depthCompare: "less"
    }
});
{% endhighlight %}

## Rendering!

Rendering in WebGPU takes place during a Render Pass, which is
described through a [`GPURenderPassDescriptor`](https://gpuweb.github.io/gpuweb/#dictdef-gpurenderpassdescriptor).
The render pass descriptor specifies the images to bind to the output slots
written from the fragment shader, and optionally a depth buffer
and the occlusion query set. The color and depth attachments specified must
match the color and depth states specified for the render pipelines used in the render pass.
Our fragment shader writes to a single output slot, the object color, which we'll write
to the current swap chain image. As the image will change each frame
to the current swap chain image, we don't set it just yet.
{% highlight js %}
var renderPassDesc = {
    colorAttachments: [{
        attachment: undefined,
        loadValue: [0.3, 0.3, 0.3, 1]
    }],
    depthStencilAttachment: {
        attachment: depthTexture.createView(),
        depthLoadValue: 1.0,
        depthStoreOp: "store",
        stencilLoadValue: 0,
        stencilStoreOp: "store"
    }
};
{% endhighlight %}

All that's left to do is write our rendering loop, and pass it to `requestAnimationFrame`
to call it each frame to update the image.
To record and submit GPU commands, we use a [`GPUCommandEncoder`](https://gpuweb.github.io/gpuweb/#command-encoder).
The command encoder can be used to prerecord and command buffers that can
be submitted multiple times to the GPU, or rerecord and submit each frame.
As we'll be changing the render pass color attachment each frame, we'll be
rerecording and submitting the command buffer each frame.

For each frame, we get the latest swap chain image which we should write rendering outputs
to and set this as our output color attachment image.
We then create a command encoder to record our rendering commands.
We begin the render pass by calling `beginRenderPass` and passing our render pass descriptor
to get back a [`GPURenderPassEncoder`](https://gpuweb.github.io/gpuweb/#gpurenderpassencoder),
that will allow us to record rendering commands.
We can then set the render pipeline to use, bind our vertex buffers to the
corresponding input slots, draw the triangle, and end the render pass.
To get a command buffer which can be submitted to the GPU for execution
we call `finish` on the command encoder. The returned command buffer
is then passed to the device for execution. After the command buffer is run
our triangle will be written to the swap chain image and displayed on the
canvas as shown below!

{% highlight js %}
// Render!
var frame = function() {
    // Update the color output image to the current swap chain render target
    renderPassDesc.colorAttachments[0].attachment = swapChain.getCurrentTexture().createView();

    var commandEncoder = device.createCommandEncoder();
    
    var renderPass = commandEncoder.beginRenderPass(renderPassDesc);

    renderPass.setPipeline(renderPipeline);
    renderPass.setVertexBuffer(0, dataBuf);
    renderPass.draw(3, 1, 0, 0);

    renderPass.endPass();
    device.defaultQueue.submit([commandEncoder.finish()]);

    requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
{% endhighlight %}


<div class="col-12 row">
    <div class="col-12 d-flex justify-content-center">
        <canvas id="webgpu-canvas" width="640" height="480"></canvas>
    </div>
    <div class="col-12 alert alert-danger" id="no-webgpu" style="display:none;">
        <h4>Error: Your browser does not support WebGPU</h4>
    </div>
    <div class="col-12">
        {% assign figurecount = figurecount | plus: 1 %}
        <figcaption><b>Figure {{figurecount}}:</b>
        <i>Our triangle, rendered with WebGPU.
        </i></figcaption>
    </div>
</div>
<script src="/assets/webgpu/triangle.js"></script>

## Wrapping Up

With our first triangle on screen, we're well on our way to getting a basic
glTF model viewer together. In the next post, we'll look at how
to pass additional data to our shaders (e.g., uniform buffers), using
bind groups. If you run into issues getting the example to work,
[check out the code](/assets/webgpu/triangle.js) for rendering the triangle in Figure 3,
or get in touch via [Twitter](https://twitter.com/_wusher) or email.

Although WebGPU is in its early stages, here are a few useful resources
which are also worth checking out:

- Alain's [Raw WebGPU](https://alain.xyz/blog/raw-webgpu ) tutorial
- Mik's curated [Awesome WebGPU list](https://github.com/mikbry/awesome-webgpu)
- [A Taste of WebGPU in Firefox](https://hacks.mozilla.org/2020/04/experimental-webgpu-in-firefox/)
- Austin's [WebGPU Samples](https://github.com/austinEng/webgpu-samples)
- The [Safari WebGPU Demos](https://webkit.org/demos/webgpu/)
- [The WebGPU Specification](https://gpuweb.github.io/gpuweb/)

