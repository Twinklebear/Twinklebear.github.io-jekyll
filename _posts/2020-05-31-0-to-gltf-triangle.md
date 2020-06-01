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

**What's webgpu, what we're gonna do here**

<!--more-->

# Why WebGPU?

**What's cool about it, why do we want it? What's different vs. WebGL2
and native APIs?**

<figure>
	<img class="img-fluid"
		src="/assets/img/webgl-volumes/webgl-triangle-pipeline.svg"/>
	{% assign figurecount = figurecount | plus: 1 %}
	<figcaption><i>Figure {{figurecount}}:
	The graphics pipeline in WebGPU consists of two programmable shader stages:
	the vertex shader, responsible for transforming input
	vertices into clip space, and the fragment shader, responsible
	for shading pixels covered by triangle.
	</i></figcaption>
</figure>

# Getting a WebGPU Context

**First bit here would actually be on getting a browser that
even supports it**

{% highlight html %}
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <title>WebGPU</title>
</head>
<body>
    <canvas id="webgpu-canvas" class="img-fluid" width="640" height="480"></canvas>
    <script src="js/render.js"></script>
</body>
</html>
{% endhighlight %}

{% highlight js %}
(async () => {
    if (!navigator.gpu) {
        alert("WebGPU is not supported/enabled in your browser");
        return;
    }

    var adapter = await navigator.gpu.requestAdapter();
    var device = await adapter.requestDevice();

    var canvas = document.getElementById("webgpu-canvas");
    var context = canvas.getContext("gpupresent");

    // Continued...
)
{% endhighlight %}

# The WebGPU Rendering Pipeline

**The core thing we care about and want to setup is the render pipeline.
What pieces go into that and what are they? Give an overview of what's coming here**

## Shader Modules

**Compiling shaders, using them in shader modules**

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
var vertModule = device.createShaderModule({code: simple_vert_spv});
var fragModule = device.createShaderModule({code: simple_frag_spv});

vertexStage: {
    module: vertModule,
    entryPoint: "main"
},
fragmentStage: {
    module: fragModule,
    entryPoint: "main"
},
{% endhighlight %}

## Specifying Vertex Data

**How do we set up the vertex state? Think about the buffers
as mapping slots of buffer data which will be passed to the
shader from the corresponding buffer slot as described for each
attrib/buffer**

{% highlight js %}
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

vertexState: {
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
},
{% endhighlight %}

## Writing Rendering Outputs

**How do we setup the output render targets and depth buffer? Swap chain?
Render pass?**

{% highlight js %}
var swapChainFormat = "bgra8unorm";
var swapChain = context.configureSwapChain({
    device: device,
    format: swapChainFormat,
    usage: GPUTextureUsage.OUTPUT_ATTACHMENT
});

var depthTexture = device.createTexture({
    size: {
        width: canvas.width,
        height: canvas.height,
        depth: 1
    },
    format: "depth24plus-stencil8",
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

## Rendering!

**Update the render pass color attachment, make cmd encoder, record
commands and render it!**

{% highlight js %}
(async () => {
    if (!navigator.gpu) {
        alert("WebGPU is not supported/enabled in your browser");
        return;
    }

    var adapter = await navigator.gpu.requestAdapter();
    var device = await adapter.requestDevice();

    var canvas = document.getElementById("webgpu-canvas");
    var context = canvas.getContext("gpupresent");
    var swapChainFormat = "bgra8unorm";
    var swapChain = context.configureSwapChain({
        device: device,
        format: swapChainFormat,
        usage: GPUTextureUsage.OUTPUT_ATTACHMENT
    });

    var depthTexture = device.createTexture({
        size: {
            width: canvas.width,
            height: canvas.height,
            depth: 1
        },
        format: "depth24plus-stencil8",
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

    var vertModule = device.createShaderModule({code: simple_vert_spv});
    var fragModule = device.createShaderModule({code: simple_frag_spv});

    var layout = device.createPipelineLayout({bindGroupLayouts: []});

    var renderPipeline = device.createRenderPipeline({
        layout: layout,
        vertexStage: {
            module: vertModule,
            entryPoint: "main"
        },
        fragmentStage: {
            module: fragModule,
            entryPoint: "main"
        },
        primitiveTopology: "triangle-list",
        vertexState: {
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
        },
        colorStates: [{
            format: swapChainFormat
        }],
        depthStencilState: {
            format: "depth24plus-stencil8",
            depthWriteEnabled: true,
            depthCompare: "less"
        }
    });

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
})();
{% endhighlight %}

