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

In this second post of the series we'll learn about Bind Groups,
which let us pass buffers and textures to our shaders.
When writing a renderer, we typically have inputs which do not make sense as vertex
attributes (e.g., transform matrices, material parameters), or simply cannot be passed
as vertex attributes (e.g., textures). Such parameters are instead
passed as uniforms in GLSL terms, or root parameters in HLSL terms.
The application then associates the desired buffers and textures with the
parameters in the shader. In WebGPU, the association of data to parameters is made using Bind Groups.
In this post, we'll use Bind Groups to pass a uniform buffer containing a view
transform to our vertex shader, allowing us to add camera controls to our triangle
from the previous post.
If you haven't read the [first post in this series]({% post_url 2020-06-15-0-to-gltf-triangle %})
I recommend reading that first, as we'll continue directly off the code written there.

<!--more-->

# Bind Groups in WebGPU

At a high level, bind groups follow a similar model to vertex buffers in WebGPU.
Each bind group specifies an array of buffers and textures which it contains, and
the parameter binding indices to map these too in the shader. Each pipeline specifies
that it will use zero or much such bind groups. During rendering, the bind groups required
by the pipeline are bound to the corresponding bind group slots specified
when creating the pipeline layout, to bind data to the shader parameters.
The bind group layout and bind groups using the layout are treated as
separate objects, allowing parameter values to be changed without
changing the entire rendering pipeline.
By using multiple bind group sets, we can swap out per-object parameters
without conflicting with bind groups specifying global parameters during rendering.
The bind group parameters can be accessible in
both the vertex and fragment stages (or, compute). An example pipeline using
two bind group sets is illustrated in the figure below.

<figure>
	<img class="img-fluid"
		src="/assets/img/webgpu-bg-slots.svg"/>
	{% assign figurecount = figurecount | plus: 1 %}
	<figcaption><b>Figure {{figurecount}}:</b>
	<i>Specifying bind groups in WebGPU. 
    Each bind group contains an array of buffers or textures,
    which are passed to the shader
    parameters as specified by the bind group layout.
    Multiple bind groups can be used during rendering, by binding
    them to different set slots. The set terminology matches
    that of Vulkan, where multiple VkDescriptorSet objects
    are bound to associate data with shader uniform parameters.
	</i></figcaption>
</figure>

## Accessing Bind Group Parameters in the Shader

To add camera controls to our triangle from before, we'll pass a combined
projection and view matrix through to our vertex shader and use it
to transform the triangle's vertices.
The transform matrix will be stored in a uniform buffer, read by the shader.
Uniform buffers are used to pass small to medium size buffers of constant data to shaders,
WebGPU also supports storage buffers, which can be used to pass larger
or shader writeable buffers.

In GLSL, the different input slots to which bind groups are bound are referred
to as sets. Each bind group bound to a set contains some number of parameter bindings,
which are mapped to the corresponding parameters in the shader.
Uniform shader parameters in GLSL are annotated with the corresponding set and binding which will
provide the underlying data for the parameter, using the `layout` qualifier.
Here we'll have a single set, set 0, which binds the uniform buffer containing our
transform matrix to binding 0.
The updated vertex shader that applies the transform passed through the uniform
buffer to our vertices is shown below.

{% highlight glsl %}
#version 450 core

layout(location = 0) in vec4 pos;
layout(location = 1) in vec4 vcolor;

layout(location = 0) out vec4 fcolor;

// Our uniform buffer containing the projection * view matrix
layout(set = 0, binding = 0, std140) uniform ViewParams {
    mat4 proj_view;
};

void main(void) {
    fcolor = vcolor;
    gl_Position = proj_view * pos;
}
{% endhighlight %}


## Creating the Bind Group and Pipeline Layout

The layouts of the bind groups used by a pipeline are part of the pipeline's layout.
As discussed last time, by fixing the
configuration of inputs to the pipeline, the GPU can better optimize execution of
the pipeline.
The layouts of the bind groups which will be used in the pipeline
are specified through an array of [`GPUBindGroupLayout`](https://gpuweb.github.io/gpuweb/#bind-group-layout)
objects which are passed to [`createPipelineLayout`](https://gpuweb.github.io/gpuweb/#device-create-pipeline-layout)
through the `bindGroupLayouts` member.
The index of a bind group layout in the pipeline layout's `bindGroupLayouts` array
is its set number in GLSL. The actual data associated with the binding points
of each layout is specified separately, allowing re-use of the pipeline and
layout with different inputs.
The bind group and pipeline layout which we'll use in this post is illustrated below.

<figure>
	<img class="img-fluid"
		src="/assets/img/webgpu-bg-slots-triangle.svg"/>
	{% assign figurecount = figurecount | plus: 1 %}
	<figcaption><b>Figure {{figurecount}}:</b>
	<i>An illustration of the bind group layout used in this post.
    We pass a single uniform buffer to the shaders in set 0. The uniform
    buffer in this bind group will contain our view transform matrix.
	</i></figcaption>
</figure>

The bind group layout is created through [`createBindGroupLayout`](https://gpuweb.github.io/gpuweb/#GPUDevice-createBindGroupLayout),
which takes a list of entries that the corresponding bind group used during rendering must contain.
Each [entry](https://gpuweb.github.io/gpuweb/#dictdef-gpubindgrouplayoutentry) specifies the type
of the parameter, which shader stages will be able to
access it, and the binding number to place the parameter at in the shader.
After creating the bind group layout we use it to create our pipeline layout,
specifying that pipelines created using the layout (i.e., our rendering pipeline)
will use bind groups matching the bind group layouts specified.

{% highlight js %}
// Create the bind group layout
var bindGroupLayout = device.createBindGroupLayout({
    entries: [
        {
            binding: 0,
            // One or more stage flags, or'd together
            visibility: GPUShaderStage.VERTEX,
            type: "uniform-buffer"
        }
    ]
});

// Create the pipeline layout, specifying which bind group layouts will be used
var layout = device.createPipelineLayout({bindGroupLayouts: [bindGroupLayout]});
{% endhighlight %}

## Creating a Uniform Buffer and Bind Group

We'll create a uniform buffer to store our view transform, which will be used
as a uniform buffer (in our bind group), and a copy destination buffer.
The latter usage will allow us to update the buffer's data each frame
by copying in a new view transform.

{% highlight js %}
// Create a buffer to store the view parameters
var viewParamsBuffer = device.createBuffer({
    size: 16 * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
});
{% endhighlight %}

The [`GPUBindGroup`](https://gpuweb.github.io/gpuweb/#gpu-bind-group) specifies the
actual buffers or textures which will be passed to the shaders. During
rendering, each bind group is bound to the index of its corresponding layout in
the pipeline's `bindGroupLayouts` array.
The bind group using our bind group layout passes our view parameter buffer at binding 0, matching the layout.
For bind groups with multiple entries, the order of the entries specified in the
layout and bind group do not
need to match; however, for each binding index specified in the layout,
a matching binding must be specified in the bind group.

{% highlight js %}
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

## Integrating an Arcball Camera

Next, we need a camera controller to update the view transform
based on the user's input. I'll be using my implementation of
the [Shoemake Arcball Camera](https://www.talisman.org/~erlkonig/misc/shoemake92-arcball.pdf),
which you can get from my [webgl-utils](https://github.com/Twinklebear/webgl-util/releases) library.
The library uses [gl-matrix](https://github.com/toji/gl-matrix) as its math library,
which you'll need to download separately.
WebGL Utils also provides a simple controller object which can be bound to the
canvas to more easily apply user inputs to the camera.
If you have your own preferred camera and controller code, you can also use that,
all we'll need in the end is to update the view transform based on
the user's inputs.

{% highlight js %}
// Create an Arcball camera and view projection matrix
var camera = new ArcballCamera([0, 0, 3], [0, 0, 0], [0, 1, 0],
    0.5, [canvas.width, canvas.height]);

// Create a perspective projection matrix
var projection = mat4.perspective(mat4.create(), 50 * Math.PI / 180.0,
    canvas.width / canvas.height, 0.1, 100);

// Matrix which will store the computed projection * view matrix
var projView = mat4.create();

// Controller utility for interacting with the canvas and driving the Arcball camera
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

## Updating the View Transform During Rendering

With everything set up, all that's left to do each frame is upload
the new view transform, set our bind group, and render!
After computing the combined projection and view matrix using
the updated view transform (stored in `camera.camera`), we create a
mapped staging buffer to upload the transform to the GPU.
In WebGPU, the `MAP_READ` and `MAP_WRITE` usage modes cannot be combined
with any modes other than `COPY_DST` and `COPY_SRC`, respectively,
and thus we cannot map back our view parameters buffer to write to it directly.
For simplicity, each frame we'll just create a new mapped buffer to
upload our view transform. We set this buffer's usage as `COPY_SRC`,
meaning that we'll use it to copy data from it into another buffer,
i.e., into our uniform buffer.
We then copy the uploaded view matrix into our uniform buffer
by enqueuing a [`copyBufferToBuffer`](https://gpuweb.github.io/gpuweb/#GPUCommandEncoder-copyBufferToBuffer)
command on the command encoder before beginning our rendering pass.
In the rendering pass, we set the bind group to be used before rendering our triangle
by calling [`setBindGroup`](https://gpuweb.github.io/gpuweb/#dom-gpuprogrammablepassencoder-setbindgroup)
on the render pass, specifying the bind group set number to place our bind group at.
After the command buffer is run we'll have our triangle rendered with our
view transform applied, as shown below!

{% highlight js %}
var frame = function() {
    renderPassDesc.colorAttachments[0].attachment =
        swapChain.getCurrentTexture().createView();

    // Compute and upload the combined projection and view matrix
    projView = mat4.mul(projView, projection, camera.camera);
    var upload = device.createBuffer({
        size: 16 * 4,
        usage: GPUBufferUsage.COPY_SRC,
        mappedAtCreation: true
    });
    new Float32Array(upload.getMappedRange()).set(projView);
    upload.unmap();

    var commandEncoder = device.createCommandEncoder();

    // Copy the upload buffer to our uniform buffer
    commandEncoder.copyBufferToBuffer(upload, 0, viewParamsBuffer, 0, 16 * 4);

    var renderPass = commandEncoder.beginRenderPass(renderPassDesc);

    renderPass.setPipeline(renderPipeline);
    renderPass.setVertexBuffer(0, dataBuf);
    // Set the bind group to its associated slot
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

Now that we've learned about bind groups, we'll be able to use them to pass view and
object transform matrices, material parameters, and textures, to our shaders. In the
next post, we'll take a look at the glTF Binary format to load and render our
first real triangle mesh.
If you run into issues getting the example to work,
[check out the code](/assets/webgpu/triangle_bind_groups.js) for rendering the triangle in Figure 3,
or get in touch via [Twitter](https://twitter.com/_wusher) or email.

## Update 8/24

Updated from `device.createBufferMapped` to `device.createBuffer` with the `mappedAtCreation` parameter set.
See the [corresponding Dawn PSA about these changes in Chrome and WebGPU](https://hackmd.io/szV68rOVQ56GYzPJMBko8A#PSA-for-Chromium--Dawn-WebGPU-API-updates-2020-07-28).

