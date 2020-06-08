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
control over the GPU, allowing programs to leverage the hardware
more efficiently in a manner similar to Vulkan and DirectX 12.
WebGPU also exposes additional GPU capabilities, such as compute
shaders and storage buffers, enabling powerful GPU compute applications
to run on the web.
In this series, we'll learn the key aspects of WebGPU from the ground up,
with the goal of going from zero to a basic glTF model renderer.
This post marks our initial step on this journey, where we'll setup
a WebGPU context and get a basic triangle on the screen.

<!--more-->

# Getting a WebGPU Context

The first step to working with WebGPU is to get setup with a browser
with WebGPU enabled. Chrome, Firefox, and Safari's implementations
are [still in progress](https://github.com/gpuweb/gpuweb/wiki/Implementation-Status),
and as such we need to use the corresponding nightly
browsers provided by the vendors. At the time of writing, I've found that Chrome Canary
has the most complete implementation, and recommend using it for
development at the moment. You'll also need to enable the WebGPU feature
in the nightly browser, following the [guide here](https://github.com/gpuweb/gpuweb/wiki/Implementation-Status).
Browser support is still in progress and it is not advised to leave
WebGPU enabled during regular web browsing.
You can check if you've got WebGPU enabled by jumping to the bottom of this
post, where you should see the triangle we're going to be rendering. If
WebGPU isn't enabled, you'll see an error message there instead.

The initial setup of our WebGPU rendering context is similar to WebGL2.
Our webpage will have a canvas, which will display our rendered outputs,
and any other HTML we need for our UI, etc. Here we'll just load our
rendering code, in `render.js`.

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
Our first step is to get an [`GPUAdapter`](https://gpuweb.github.io/gpuweb/#adapter)
from the WebGPU API. Each adapter represents a GPU on the machine
combined with the browser's implementation of WebGPU on top of that GPU.
We can then request a [`GPUDevice`](https://gpuweb.github.io/gpuweb/#devices)
from the adapter, which will allow us to create GPU objects and
execute commands on the hardware. This distinction is similar
to that of `VkPhysicalDevice` and `VkDevice` in Vulkan, where
the former corresponds to the WebGPU `GPUAdapter` and the latter
to the `GPUDevice`.
As with WebGL2, we need a context for the canvas which will
be used to display our rendered image. To use WebGPU with the
canvas, we request a `gpupresent` context.
After this setup, we can load our shaders and vertex
data, configure our render targets, and build our render pipeline, to get
our triangle on the screen.

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
vertex and fragment stage, similar to WebGL2.
WebGPU also adds a separate compute shader stage, which exists outside
the rendering pipeline.

<figure>
	<img class="img-fluid"
		src="/assets/img/webgl-volumes/webgl-triangle-pipeline.svg"/>
	{% assign figurecount = figurecount | plus: 1 %}
	<figcaption><b>Figure {{figurecount}}:</b>
	<i>The graphics pipeline in WebGPU consists of two programmable shader stages:
	the vertex shader, responsible for transforming input
	vertices into clip space, and the fragment shader, responsible
	for the shading pixels covered by each triangle.
	</i></figcaption>
</figure>

To render our triangle, we'll need to configure such a pipeline,
which in WebGPU is setup as a concrete object representing the
pipeline state.
A number of the different aspects of the pipeline (e.g., the shaders,
vertex state, render outputs, etc.) are fixed, allowing the GPU
to better optimize rendering for the pipeline. In contrast, when using
WebGL2 the shaders, vertex state, etc., can be swapped out at any time
between draw calls, making such optimizations difficult.
However, frequent pipeline changes should likely be avoided in WebGPU
(best practices from Vulkan and DX12 apply here).

## Shader Modules

**Compiling shaders, using them in shader modules**

{% highlight glsl %}
// Vertex shader
#version 450 core

layout(location = 0) in vec3 pos;
layout(location = 1) in vec4 vcolor;

layout(location = 0) out vec4 fcolor;

void main(void) {
    fcolor = vcolor;
    gl_Position = vec4(pos, 1);
}
{% endhighlight %}

{% highlight glsl %}
// Fragment shader
#version 450 core

layout(location = 0) in vec4 fcolor;

layout(location = 0) out vec4 color;

void main(void) {
    color = fcolor;
}
{% endhighlight %}

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

## Specifying Vertex Data

**How do we set up the vertex state? Think about the buffers
as mapping slots of buffer data which will be passed to the
shader from the corresponding buffer slot as described for each
attrib/buffer**

{% highlight js %}
// Specify vertex data
var [dataBuf, dataBufMapping] = device.createBufferMapped({
    size: 3 * 2 * 4 * 4,
    usage: GPUBufferUsage.VERTEX
});
// Interleaved positions and colors
new Float32Array(dataBufMapping).set([
    1, -1, 0, 1,
    1, 0, 0, 1,
    -1, -1, 0, 1,
    0, 1, 0, 1,
    0, 1, 0, 1,
    0, 0, 1, 1,
]);
dataBuf.unmap();

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

**How do we setup the output render targets and depth buffer? Swap chain?
Render pass?**

{% highlight js %}
// Setup render outputs
var swapChainFormat = "bgra8unorm";
var swapChain = context.configureSwapChain({
    device: device,
    format: swapChainFormat,
    usage: GPUTextureUsage.OUTPUT_ATTACHMENT
});

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

## Creating the Rendering Pipeline

**Make the pipeline layout and pipeline, don't worry about
bind groups for now we'll look at that later (but give a hint what this is for**

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

**Update the render pass color attachment, make cmd encoder, record
commands and render it!**

{% highlight js %}
// Render!
var frame = function() {
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

<div class="col-12 d-flex justify-content-center">
<canvas id="webgpu-canvas" width="640" height="480"></canvas>
<div class="alert alert-danger" id="no-webgpu" style="display:none;">
    <h4>Error: Your browser does not support WebGPU</h4>
</div>
</div>
<script src="/assets/webgpu_triangle.js"></script>

## Wrapping Up

Other links to mention:

- The spec https://gpuweb.github.io/gpuweb/
- Alain's Raw WebGPU (typescript) https://alain.xyz/blog/raw-webgpu
- https://github.com/mikbry/awesome-webgpu
- https://hacks.mozilla.org/2020/04/experimental-webgpu-in-firefox/

