---
layout: post
title: "From 0 to glTF with WebGPU: Bind Groups"
description: ""
category: graphics
tags: [graphics, webgpu]
published: true
---
{% include JB/setup %}

{% assign figurecount = 0 %}

In this second post of my series glTF rendering in WebGPU, we'll learn about Bind Groups,
which let us pass buffers and textures to our shaders.
When writing a renderer, we typically have inputs which do not make sense as vertex
attributes (e.g., transform matrices, material parameters), or simply cannot be passed
as vertex attributes (e.g., texture handles). Such parameters are instead
passed as "uniform" parameters, in GLSL terms, or root parameters, in HLSL terms.
The application is then responsible for associating buffers and textures with the
parameters in the shader. WebGPU makes this association using Bind Groups.
We'll use bind groups to pass a uniform buffer containing a view
transform to our vertex shader, allowing us to add camera controls to our triangle
from the previous post.
If you haven't read the [first post in this series]({% post_url 2020-06-15-0-to-gltf-triangle %}),
I recommend reading that first, as we'll continue directly off the code written there.

<!--more-->

# Bind Groups in WebGPU

At a high level, bind groups follow a similar model to vertex buffers in WebGPU.
Each bind group specifies a set of buffers and textures which it contains, and
the shader binding slots to map these too. Each pipeline specifies that it will
use zero or much such bind groups. During rendering, the bind groups required
by the pipeline are bound to the corresponding bind group slots, to set
the desired parameters. The bind group parameters are accessible in
both the vertex and fragment stages. This is illustrated in the figure below.

<figure>
	<img class="img-fluid"
		src="/assets/img/webgpu-bg-slots.svg"/>
	{% assign figurecount = figurecount | plus: 1 %}
	<figcaption><b>Figure {{figurecount}}:</b>
	<i>Specifying bind groups to map to bind group slots for a
    rendering pipeline. Each bind group contains some set of
    buffers or textures, which are passed to the shader
    parameters as specified by the bind group layout.
	</i></figcaption>
</figure>

The bind group layout and bind groups using the layout are treated as
separate objects, allowing the parameter values to be changed without
requiring the entire rendering pipeline to be changed. For a single
bind group layout (and thus, pipeline layout), we can swap out the
data passed to its parameters, similar to vertex buffers. **reword**

{% highlight glsl %}
#version 450 core

layout(location = 0) in vec4 pos;
layout(location = 1) in vec4 vcolor;

layout(location = 0) out vec4 fcolor;

layout(set = 0, binding = 0, std140) uniform ViewParams {
    mat4 view_proj;
};

void main(void) {
    fcolor = vcolor;
    gl_Position = view_proj * pos;
}
{% endhighlight %}


<figure>
	<img class="img-fluid"
		src="/assets/img/webgpu-bg-slots-triangle.svg"/>
	{% assign figurecount = figurecount | plus: 1 %}
	<figcaption><b>Figure {{figurecount}}:</b>
	<i>An illustration of the bind group layout used in this post.
    We pass a single uniform buffer to the shaders, which will contain
    our view transform matrix.
	</i></figcaption>
</figure>

{% highlight js %}
// Create the bind group layout
var bindGroupLayout = device.createBindGroupLayout({
    entries: [
        {
            binding: 0,
            visibility: GPUShaderStage.VERTEX,
            type: "uniform-buffer"
        }
    ]
});

// Create render pipeline
var layout = device.createPipelineLayout({bindGroupLayouts: [bindGroupLayout]});
{% endhighlight %}

{% highlight js %}
// Create a buffer to store the view parameters
var viewParamsBuffer = device.createBuffer({
    size: 16 * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
});

// Create a bind group which places our view params buffer at binding 0
var bindGroup = device.createBindGroup({
    layout: bindGroupLayout,
    entries: [
        {
            binding: 0,
            resource: {
                buffer: viewParamsBuffer
            }
        }
    ]
});
{% endhighlight %}

{% highlight js %}
// Create an arcball camera and view projection matrix
var camera = new ArcballCamera([0, 0, 3], [0, 0, 0], [0, 1, 0],
    0.5, [canvas.width, canvas.height]);
var projection = mat4.perspective(mat4.create(), 50 * Math.PI / 180.0,
    canvas.width / canvas.height, 0.1, 100);
// Matrix which will store the computed projection * view matrix
var projView = mat4.create();

// Controller utility for interacting with the canvas and driving
// the arcball camera
var controller = new Controller();
controller.mousemove = function(prev, cur, evt) {
    if (evt.buttons == 1) {
        camera.rotate(prev, cur);

    } else if (evt.buttons == 2) {
        camera.pan([cur[0] - prev[0], prev[1] - cur[1]]);
    }
};
controller.wheel = function(amt) { camera.zoom(amt * 0.5); };
controller.registerForCanvas(canvas);
{% endhighlight %}

{% highlight js %}
var frame = function() {
    renderPassDesc.colorAttachments[0].attachment =
        swapChain.getCurrentTexture().createView();

    // Upload the combined projection and view matrix
    projView = mat4.mul(projView, projection, camera.camera);
    var [upload, mapping] = device.createBufferMapped({
        size: 16 * 4,
        usage: GPUBufferUsage.COPY_SRC
    });
    new Float32Array(mapping).set(projView);
    upload.unmap();

    var commandEncoder = device.createCommandEncoder();

    // Copy the upload buffer to our uniform buffer
    commandEncoder.copyBufferToBuffer(upload, 0, viewParamsBuffer, 0, 16 * 4);

    var renderPass = commandEncoder.beginRenderPass(renderPassDesc);

    renderPass.setPipeline(renderPipeline);
    renderPass.setVertexBuffer(0, dataBuf);
    renderPass.setBindGroup(0, bindGroup);
    renderPass.draw(3, 1, 0, 0);

    renderPass.endPass();
    device.defaultQueue.submit([commandEncoder.finish()]);
    requestAnimationFrame(frame);
}
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
        <i>Our triangle, rendered with WebGPU. Controls: left-click to drag, right-click to
        pan, scroll to zoom.
        </i></figcaption>
    </div>
</div>

<script src="/assets/gl-matrix-min.js"></script>
<script src="/assets/webgl-util.min.js"></script>
<script src="/assets/webgpu/triangle_bind_groups.js"></script>

## Wrapping Up

