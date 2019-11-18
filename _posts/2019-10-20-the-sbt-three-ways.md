---
layout: post
title: "The Shader Binding Table Three Ways"
description: ""
category: graphics
tags: [graphics, raytracing]
published: true
mathjax: true
---
{% include JB/setup %}

{% assign figurecount = 0 %}

DirectX Ray Tracing, Vulkan's NV Ray Tracing extension, and OptiX (or collectively, the RTX APIs)
build on the same execution model for running user code to trace
and process rays. The user creates a *Shader Binding Table* (SBT), which consists of a set
of shader function handles and embedded parameters for these functions. The shaders in the table
are executed depending on whether or not a geometry was hit by a ray, and which geometry was hit.
When a geometry is hit a set of parameters specified on both the host and
device side of the application combine to determine which shader is executed.
The RTX APIs provide a great deal of flexibility in how the SBT can be set up and
indexed into during rendering, leaving a number of options open to applications.
However, with incorrect SBT access leading
to crashes and difficult bugs, sparse examples or documentation, and
subtle differences in naming and SBT setup between the APIs, properly setting up
and accessing the SBT is an especially thorny part of the RTX APIs for new users.

In this post we'll look at the similarities and differences of each ray tracing API's shader
binding table to gain a fundamental understanding of the execution model. I'll then
present an interactive tool for constructing the SBT, building a scene which uses it,
and executing trace calls on the scene to see which hit groups and miss shaders are called.
Finally, we'll look at how this model can be brought back to the CPU using Embree,
to potentially build a unified low-level API for ray tracing.

*Lead-in: some stuff like the SBT setup and how the different options for
tweaking how it's indexed can be confusing to work out. The information around
is a bit partial and most people are left to kind of work out the math or some
guess work to see what's going on. Here I'll explain each and provide an interactive
tool for playing with how the SBT is setup and indexed in the shader.
Also explain difference of a shader vs. the shader record, which is more like
a closure in that you need a SR for each unique combination of function and SBT parameters.*

<!--more-->

# The RTX Execution Model

To motivate why the RTX APIs need a shader binding table, we can look at how 
ray tracing differs from rasterization.
In a rasterizer we can batch objects by the shader they use and thus
always know the set of shaders which must be called to render a set of objects.
However, in a ray tracer we don't know
which object a ray will hit when we trace it, and thus need the entire scene available
in memory (or some proxy of it) to process the ray. Our ray tracer needs both the data for
each object and a function to call for that object which can process intersections.
To render the scene we need access to all of the shaders which might be called, and a way
to associate them with the objects in the scene. Each of the RTX APIs does this through
the *Shader Binding Table*. An analogy in the rasterization pipeline is bindless rendering, where
the required data (textures, buffers) is uploaded to the GPU and accessed as needed by ID
at runtime in the shader. Our shader dispatch is now "bindless" in some sense.

<figure>
	<!--<img class="img-fluid" src="https://i.imgur.com/YqdyKCj.png"/>-->
	{% assign figurecount = figurecount | plus: 1 %}
	<figcaption><b>Figure {{figurecount}}:</b>
    <i>The RTX API ray tracing pipeline, with locations where the SBT is
    queried for a shader to call highlighted.
	</i></figcaption>
</figure>

The different shaders used in the ray tracing pipeline are:

- Ray Generation: Called as the entry point to the ray tracer to generate the rays
    to be processed.
- Intersection: When using non-triangle geometry an intersection shader is required
    to compute ray intersections with the custom primitives. This isn't necessary
    for triangle meshes, as the ray-triangle intersection test is done in hardware.
- Any Hit: Is called for each potential intersection found along the ray,
    and can be used to filter potential intersections. For example, when using alpha
    cutout textures, the Any Hit shader is used to discard hits against the cutout regions
    of the geometry.
- Closest Hit: Is called for the closest hit found along the ray, and can compute and
    return intersection information through the ray payload or trace rays if performing
    shading in the Closest Hit shader is desired.
- Miss: When no hit is found for a ray, the miss shader is called. The Miss shader
    can be used to return a background color for primary rays, or mark occlusion rays
    as unoccluded.

For a detailed overview and other interesting applications and use cases, see the
[Ray Tracing Gems Book](http://www.realtimerendering.com/raytracinggems/),
or check out the
[Introduction to DirectX Ray Tracing](http://intro-to-dxr.cwyman.org/) course
given at SIGGRAPH 2018, or [Optix 7 Tutorial](https://gitlab.com/ingowald/optix7course)
given at SIGGRAPH 2019.

# The Shader Binding Table

*consists of a set of shader records, where each is a function (or functions for hit group)
and parameters for those functions*

The Shader Binding Table contains the entire set of shaders which may be called when ray tracing
the scene, along with embedded parameters to be passed to these shaders. Each pair
of shader functions and embedded parameters is referred to as a *Shader Record*.
Since it's common for objects to share the same shader code but access different
data, the embedded parameters in the record can be used to pass such data to
the shaders. Thus, there should be at least one Shader Record in the table for
each unique combination of shader functions and embedded parameters. It is possible
to write the same shader record multiple times in the table, and this may be
necessary depending on how the instances and geometries in the scene are specified.
Finally, it is also possible to simply use the instance and geometry IDs available
in the shaders to perform indirect access into other tables containing the scene data.

## Shader Record

*Think of a shader record like a closure, it combines a set of parameters + a function
to be called for some object or ray*

A Shader Record combines one or more shader functions with a set of parameters to
be passed to these functions when they're called by the runtime.
Each shader record is written into the SBT as a set of function handles followed by the
embedded parameters. While the size of the handles, alignment requirements for
the records and parameters which can be embedded in the table differ across
the RTX APIs, the functionality of the shader record is the same. 

#### Ray Generation

The Ray Generation shader record consists of a single function referring to the
ray generation shader to be used, along with any desired embedded parameters
for the function. While some parameters can be passed in the shader record, for things
which update each frame it can be easier to pass them separately through a
different globally accessible buffer.
While multiple ray generation shaders can be written into the table,
only one can be called for a specific launch.

#### Hit Group

Each Hit Group shader record consists of a Closest Hit shader,
Any Hit shader (optional) and Intersection shader (optional), followed by
the set of embedded parameters to be made available to the three shaders.
As the hit group which should be called is dependent on the instance
and geometry which were hit and the ray type, the indexing rules for hit groups are
the most complicated. The rules for hit group indexing are discussed in detail
below.

#### Miss

The Miss shader record consists of a single function referring to the miss shader
to be used, along with any desired embedded parameters for the function,
similar to the ray generation record. The miss shader which is called is selected
by the ray type, though is specified separately from the hit group ray type to
allow greater flexibility. This flexibility can be used for optimizations to
[occlusion rays, for example](/graphics/2019/09/06/faster-shadow-rays-on-rtx).

## Hit Group Shader Record Index Calculation

The main point of difficulty in setting up the SBT and scene geometry is understanding
how the two are coupled together, i.e., if a geometry is hit by a ray,
which shader record is called? The shader record to call is determined by parameters set on the
instance, trace ray call and the order of geometries in the bottom-level acceleration structure.
These parameters are set on both the host and device during different parts of the scene
and pipeline setup and execution, making it difficult to see how they fit together.

The equation used to determine which hit group record is called when a ray with SBT
offset $$R_\text{offset}$$ and stride $$ R_\text{stride} $$ hits a geometry is:

$$
\begin{align}
\text{HG} = \&\text{HG}[0] + \left( \text{HG}_\text{stride} \times
    \left( R_\text{offset} + R_\text{stride} \times \mathbb{G}_\text{id} + \mathbb{I}_\text{offset} \right)\right)
\end{align}
$$

Where $$\mathbb{I}_\text{offset}$$ is the SBT offset of the instance containing the geometry,
and $$\mathbb{G}_\text{id}$$ is the index of the hit geometry in the list of geometries in the instance.
$$\&\text{HG}[0]$$ is the starting address of the table containing the hit group records, and $$\text{HG}_\text{stride}$$
is the stride between hit group records (in bytes) in the SBT.

> Note: If you're coming from Ray Tracing Gems, in 3.10 the parameter $$R_\text{offset}$$ is referred
> to as $$I_\text{ray}$$, and $$R_\text{stride}$$ is referred to as $$\mathbb{G}_\text{mult}$$.
> While the equations are the same, I think the distinction of which parameters come from the ray,
> geometry and instance are clearer when written as above.

The ray offset ($$R_\text{offset}$$) and stride ($$R_\text{stride}$$) parameters are set per-ray
when you call trace ray on the device. In a typical ray tracer, $$R_\text{offset}$$ is the ray type,
e.g., primary (0) or occlusion (1), and $$R_\text{stride}$$ is the total number of ray types, in this example, 2.
These parameters allow us to change which hit group is called based on
the desired ray query. For example, we can often perform a cheaper intersection test for occlusion
rays since we only care if the object was hit, but don't need the exact hit point.
The ray stride lets us
stride over the hit groups by the number of different ray queries we want to perform, similar to a 2D array
of elements. In a typical ray tracer where we would have a separate primary and occlusion hit group
record per-geometry, this stride would be 2.

The instance offset ($$\mathbb{I}_\text{offset}$$) and geometry id ($$\mathbb{G}_\text{id}$$)
come from how each instance is configured when setting up the scene on the host. Each instance takes
a base offset into the SBT, which defines where its sub-table of hit group
records begins. Note that this is not multiplied by $$R_\text{stride}$$ in Equation 1.
The geometry id, $$\mathbb{G}_\text{id}$$, is set implicitly as the index of the geometry
in the bottom-level acceleration structure being instanced, and is multiplied by the ray stride.
In a typical ray tracer with two ray types (primary and occlusion), a hit group record for each ray type
per-geometry and instances do not share hit group records, the offset
$$\mathbb{I}_\text{offset}^i$$ for instance $$i$$ can be calculated as:

$$
\begin{align*}
\mathbb{I}_\text{offset}^i &= \mathbb{I}_\text{offset}^{i - 1} + \mathbb{I}_\text{geom}^{i - 1} \times 2 \\
\text{where} \;\; \mathbb{I}_\text{offset}^0 &= 0 \\
\end{align*}
$$

Where $$\mathbb{I}_\text{geom}^i$$ are the number of geometries in instance $$i$$.

The hit group records in the SBT would then be written in order by instance and the geometry order within
the instance, with separate primary and occlusion hit groups. A scene with two instances, the first
with one geometry and the second with two, would have its hit group records laid out as shown below.

<figure>
	<img class="img-fluid" src="/assets/img/2instance_sbt_example.svg">
	{% assign figurecount = figurecount | plus: 1 %}
	<figcaption><b>Figure {{figurecount}}:</b>
    <i>SBT Hit Group record layout for a typical ray tracer with two ray types
    rendering a scene with two instances. In this example each hit group record
    is 32 bytes, with a stride of 64 bytes. When tracing a ray, \( R_\text{stride} = 2 \),
    and \( R_\text{offset} \)will be 0 for primary rays and 1 for occlusion rays.
	</i></figcaption>
</figure>

*Depends on:*

- *instance's sbt offset*
- *order of geometry in the instance*
- *ray sbt offset*
- *ray sbt stride*

## Miss Shader Record Index Calculation

The indexing rules for miss shader records are far simpler than for hit groups. When
tracing a ray we pass an additional miss shader offset, $$R_\text{miss}$$ which is just
the index of the miss shader to call if the ray does not hit an object.

$$
\begin{align}
\text{M} = \&\text{M}[0] + \text{M}_\text{stride} \times  R_\text{miss}
\end{align}
$$

As with the hit group records, $$ \&\text{M}[0] $$ is the starting address of the table containing
the miss records and $$\text{M}_\text{stride}$$ is the stride between miss records
in bytes.

# API Specific Details

Now that we have a unified terminology to work with across the RTX APIs, and took a brief
look at how the Shader Binding Table works, we'll dive into the API-specific details of the SBT
for each API before getting to the interactive SBT builder widget. 
The most important difference is in how the embedded parameters for a shader record
are specified, and the typos of parameters which can be embedded.
The shader record handles and the alignment requirements for them in the SBT can
also differ between the different APIs.

## DirectX Ray Tracing

For more documentation about the DXR API, also see the
[MSDN DXR Documentation](https://docs.microsoft.com/en-us/windows/win32/direct3d12/direct3d-12-raytracing),
the [DXR HLSL Documentation](https://docs.microsoft.com/en-us/windows/win32/direct3d12/direct3d-12-raytracing-hlsl-shaders)
and the [DXR Specification](https://microsoft.github.io/DirectX-Specs/d3d/Raytracing.html).
Here we'll just focus on the parts specific to the Shader Binding Table indexing.

### Shader Records and Parameters

In DXR, the parameters embedded in the shader record can be 8-byte handles
(e.g., to buffers, textures, etc.) or pairs of 4-byte constants (any single 4-byte constant
must be padded to 8-bytes). The mapping of these input parameters from the shader record
to the shader "registers" is specified using a
[Local Root Signature](https://microsoft.github.io/DirectX-Specs/d3d/Raytracing.html#resource-binding).
The registers used for the local root signature parameters should not overlap with
any coming from the global root signature, which is shared by all shaders. 

The shader handle size is defined by `D3D12_SHADER_IDENTIFIER_SIZE_IN_BYTES` (32 bytes),
the shader record stride alignment is `D3D12_RAYTRACING_SHADER_TABLE_BYTE_ALIGNMENT` (64 bytes).
The maximum size allowed for the stride is 4096 bytes, placing an upper bound on the number of
parameters which can be embedded for a shader.

### Instance Parameters

Instances in DXR are specified through the [`D3D12_RAYTRACING_INSTANCE_DESC`](https://docs.microsoft.com/en-us/windows/win32/api/d3d12/ns-d3d12-d3d12_raytracing_instance_desc)
structure:

{% highlight c++ %}
typedef struct D3D12_RAYTRACING_INSTANCE_DESC {
  FLOAT Transform[3];
  UINT InstanceID : 24;
  UINT InstanceMask : 8;
  UINT InstanceContributionToHitGroupIndex : 24;
  UINT Flags : 8;
  D3D12_GPU_VIRTUAL_ADDRESS AccelerationStructure;
} D3D12_RAYTRACING_INSTANCE_DESC;
{% endhighlight %}

The parameters which effect the SBT indexing are:

- `InstanceContributionToHitGroupIndex`: This sets the instance's SBT offset, $$\mathbb{I}_\text{offset}$$
- `InstanceMask`: While the mask does not effect which hit group is called, it can
    be used to skip traversal of instances entirely, by masking them out of the traversal

### Trace Ray Parameters

In the ray generation, closest hit and miss shaders the HLSL 
[TraceRay](https://docs.microsoft.com/en-us/windows/win32/direct3d12/traceray-function) function
can be called to trace rays through the scene.

{% highlight glsl %}
Template<payload_t>
void TraceRay(RaytracingAccelerationStructure AccelerationStructure,
              uint RayFlags,
              uint InstanceInclusionMask,
              uint RayContributionToHitGroupIndex,
              uint MultiplierForGeometryContributionToHitGroupIndex,
              uint MissShaderIndex,
              RayDesc Ray,
              inout payload_t Payload);
{% endhighlight %}

TraceRay takes the acceleration structure to trace against, a set of ray flags to adjust the traversal being
performed, the mask and SBT indexing parameters, the ray and the payload to be updated by the
closest hit or miss shaders.

- `InstanceInclusionMask`: This mask effects which instances are masked out by and'ing it
    with each instance's `InstanceMask`.
- `RayContributionToHitGroupIndex`: This is the ray's SBT offset, $$R_\text{offset}$$.
- `MultiplierForGeometryContributionToHitGroupIndex`: This is the ray's SBT stride $$R_\text{stride}$$.
- `MissShaderIndex`: This is the miss shader index to call, $$R_\text{miss}$$.

## Vulkan Ray Tracing

The most restricted of them, SBT can only store 4byte constants, this data appears
as a buffer in the shader.

{% highlight glsl %}
void traceNV(accelerationStructureNV acceleration_structure,
             uint ray_flags,
             uint instance_inclusion_mask,
             uint ray_contribution_to_hit_group_index, (sbt_record_offset)
             uint multiplier_for_geometry_contribution_to_hit_group_index, (sbt_record_stride)
             uint miss_shader_index,
             vec3 ray_origin
             float t_min
             vec3 ray_dir,
             float t_max,
             uint payload_index);
{% endhighlight %}

{% highlight glsl %}
layout(shaderRecordNV) buffer SBT {
    // data
};
{% endhighlight %}

{% highlight c++ %}
struct GeometryInstance {
    float transform[12];
    uint32_t instance_custom_index : 24;
    uint32_t mask : 8;
    uint32_t instance_offset : 24;
    uint32_t flags : 8;
    uint64_t acceleration_structure_handle;
};
{% endhighlight %}

Alignment requirements queried at runtime. Can use what the vals are on my desktop
for shaderGroupHandleSize and shaderGroupBaseAlignment

Can also talk here about how the ray payload is specified in GLSL/Vulkan

## OptiX

The most flexible of them, just write bytes and get a pointer to this data
on the GPU side. Only requirement is the alignment restriction.
The SBT data is fetched as a raw ptr to the SBT data component via
`optixGetSbtDataPointer()`.

{% highlight c %}
void optixTrace(OptixTraversableHandle handle,
    float3 rayOrigin,
    float3 rayDirection,
    float tmin,
    float tmax,
    float rayTime,
    OptixVisibilityMask visibilityMask,
    unsigned int rayFlags,
    unsigned int SBToffset,
    unsigned int SBTstride,
    unsigned int missSBTIndex
    // up to 8 32-bit values to be passed through registers
    // unsigned int &p0-p7
)
{% endhighlight %}

{% highlight c++ %}
struct OptixInstance {
    float transform[12];
    unsigned int instanceId;
    unsigned int sbtOffset;
    unsigned int visibilityMask;
    unsigned int flags;
    OptixTraversableHandle traversableHandle;
    unsigned int pad[2];
};
{% endhighlight %}

Shader handle size `OPTIX_SBT_RECORD_HEADER_SIZE` (32), shader record stride
alignment requirement is `OPTIX_SBT_RECORD_ALIGNMENT` (16).

Here can also discuss how the ray payload is set, and the trick for packing
a pointer to a stack var as the payload.

# Interactive SBT Builder

Here I'm thinking to put some D3 interactive example where you can build your
own SBT and see how the different instance, geometry and trace ray parameters
effect what entries in the SBT are accessed.

Things this should support:

- <s>need to account for the single stride param for each SBT group, right now
      it only does the alignment part.</s>
- <s>adding/removing miss groups</s>
- <s>adding/removing hit groups</s>
- <s>changing the parameters for the different shader records (add/remove)</s>
- <s>changing the API backend</s>
- <s>view the dispatch rays desc with the stride/offset/etc. values</s>
- <s>multiple geom per-instance, see what the instance contribution should be for different
    ray types in the scene</s>
- <s>changing the trace ray parameters to see which hit groups are accessed for specific
    instances and geometries</s>
- <s>see which hit group is called for a specific geometry given the current indexing params</s>
- <s>see which miss group is called for a specific trace call</s>
- <s>also show and talk about the instance mask and how this can be used</s>
- also make clear that the different shader records can be stored in different buffers

The interactive graphic style I'd like to be similar to that used in RT Gems, but with
the ability to switch API. Note that switching the API will potentially lead to making
invalid SBT entries because the data that can be set differs and how they should be
aligned. Maybe it would be better to be able to view all 3 at once, or just reset the
data when the API is switched.

<div class="col-12">
    <svg width="100%" width="800" height="380" id="sbtWidget">
    </svg>
    <div class="col-12 row mb-2">
        <div class="col-6 mb-3">
            API: <select id="selectAPI" onchange="selectAPI()">
            <option selected="selected">DXR</option>
            <option>Vulkan</option>
            <option>OptiX</option>
            </select>
        </div>
        <div class="col-6">
            Dispatch/Launch Config:
            <ul>
            <li>Raygen Size: <span id='raygenSize'></span></li>
            <li>HitGroup offset: <span id='hitGroupOffset'></span>, stride: <span id='hitGroupStride'></span></li>
            <li>Miss Shader offset: <span id='missOffset'></span>, stride: <span id='missStride'></span></li>
            </ul>
        </div>
        <div class="col-6">
            <input type="text" class="form-control" id="shaderRecordName" placeholder="Shader record name">
        </div>
        <div class="col-6">
            <button id="addHitGroup" type="button" class="btn btn-primary" onclick="addShaderRecord('hitgroup')">Add Hit Group</button>
            <button id="addMissShader" type="button" class="btn btn-primary" onclick="addShaderRecord('miss')">Add Miss Shader</button>
        </div>
        <div class="col-12" id="dxrParamsUI">
            <p class="mt-2 mb-1">Shader Record Parameters:</p>
            <button id="addConstant" type="button" class="btn btn-primary" onclick="addConstantParam()">Add 4byte Constant</button>
            <button id="addGPUHandle" type="button" class="btn btn-primary" onclick="addGPUHandleParam()">Add GPU Handle</button>
        </div>
        <div class="col-12" id="vulkanParamsUI">
            <p class="mt-2 mb-1">Shader Record Parameters:</p>
            <button id="addConstant" type="button" class="btn btn-primary" onclick="addConstantParam()">Add 4byte Constant</button>
        </div>
        <div class="col-12 row" id="optixParamsUI">
            <div class="col-12">
                <p class="mt-2 mb-1">Shader Record Parameters:</p>
            </div>
            <div class="col-12 row">
                <div class="col-6 mb-2">
                    <input type="number" class="form-control" id="structParamSize" min="0" placeholder="Struct size (bytes)"
                           oninput="addStructParam()">
                </div>
            </div>
        </div>
    </div>
</div>

This instance widget will have all the instances here, each with a list of geometries
represented as triangles
<svg width="800" height="400" class="col-12" id="instanceWidget">
</svg>
<div class="col-12 row mb-2">
    <div class="col-4">
        <label for="geometryCount">Geometries</label>
        <input type="number" min="1" class="form-control" id="geometryCount" value="1"
               oninput="updateInstance()">
    </div>
    <div class="col-4">
        <label for="instanceSbtOffset">SBT Offset</label>
        <input type="number" min="0" class="form-control" id="instanceSbtOffset" value="0"
               oninput="updateInstance()">
    </div>
    <div class="col-4">
        <label for="instanceMask">Mask</label>
        <input type="text" class="form-control" id="instanceMask" value="ff"
               oninput="updateInstance()">
    </div>
    <div class="col-4 mt-2">
        <button id="addInstance" type="button" class="btn btn-primary" onclick="addInstance()">Add Instance</button>
    </div>
    <div class="col-4 mt-2">
        <button id="setTypicalSBTOffset" type="button" class="btn btn-primary" onclick="setInstanceSBTOffset()">
        Set Recommended Offset</button>
    </div>
    <div class="col-12 alert alert-danger mt-2" role="alert" id="hgOutOfBounds" style="display:none"></div>
</div>

Craft your trace call:
<div id="dxrTrace" class="col-12">
<figure class="highlight">
<pre>
TraceRay(accelerationStructure,
    rayFlags,
    <span class="mh" id="instanceMaskVal">0xff</span>, <span class="c1">// Instance mask</span>
    <span class="mh" id="raySBTOffsetVal">0</span>, <span class="c1">// Ray SBT offset</span>
    <span class="mh" id="raySBTStrideVal">1</span>, <span class="c1">// Ray SBT stride</span>
    <span class="mh" id="missShaderIndexVal">0</span>, <span class="c1">// Miss shader index</span>
    ray,
    payload);
</pre>
</figure>
</div>

<div id="vulkanTrace" class="col-12">
<figure class="highlight">
<pre>
traceNV(accelerationStructure,
    rayFlags,
    <span class="mh" id="instanceMaskVal">0xff</span>, <span class="c1">// Instance mask</span>
    <span class="mh" id="raySBTOffsetVal">0</span>, <span class="c1">// Ray SBT offset</span>
    <span class="mh" id="raySBTStrideVal">1</span>, <span class="c1">// Ray SBT stride</span>
    <span class="mh" id="missShaderIndexVal">0</span>, <span class="c1">// Miss shader index</span>
    rayOrigin
    tmin
    rayDirection,
    tmax,
    payloadIndex);
</pre>
</figure>
</div>

<div id="optixTrace" class="col-12">
<figure class="highlight">
<pre>
optixTrace(accelerationStructure,
    rayOrigin,
    rayDirection,
    tmin,
    tmax,
    rayTime,
    <span class="mh" id="instanceMaskVal">0xff</span>, <span class="c1">// Instance mask</span>
    rayFlags,
    <span class="mh" id="raySBTOffsetVal">0</span>, <span class="c1">// Ray SBT offset</span>
    <span class="mh" id="raySBTStrideVal">1</span>, <span class="c1">// Ray SBT stride</span>
    <span class="mh" id="missShaderIndexVal">0</span>, <span class="c1">// Miss shader index</span>
    ... <span class="c1">// up to 8 32-bit values passed by reference through registers</span>);
</pre>
</figure>
</div>

<div class="col-12 row mb-2 mt-1">
    <div class="col-4">
        <label for="raySBTOffset">Ray SBT Offset</label>
        <input type="number" min="0" class="form-control" id="raySBTOffset" value="0"
               oninput="updateTraceCall();">
    </div>
    <div class="col-4">
        <label for="raySBTStride">Ray SBT Stride</label>
        <input type="number" min="0" class="form-control" id="raySBTStride" value="1"
               oninput="updateTraceCall();">
    </div>
    <div class="col-4">
        <label for="missShaderIndex">Miss Shader Index</label>
        <input type="number" min="0" class="form-control" id="missShaderIndex" value="0"
               oninput="updateTraceCall();">
    </div>
    <div class="col-4">
        <label for="rayInstanceMask">Instance Visibility Mask</label>
        <input type="text" class="form-control" id="rayInstanceMask" value="ff"
               oninput="updateTraceCall();">
    </div>
    <div class="col-4 mt-4">
        <button id="showMissShader" type="button" class="btn btn-primary" onclick="showMissShader()">
        Show Miss Shader</button>
    </div>
    <div class="col-12 mt-2 alert alert-danger" role="alert" id="missOutOfBounds" style="display:none">
    </div>
</div>

# Extra: An SBT for Embree

We can do the same thing with Embree since the whole code is in our control for
how calls get dispatched. So if we want a consistent API for ray tracing we can
actually implement an SBT for Embree as well. We could implement one that works
just like OptiX to prove an easy example.

<script src="https://d3js.org/d3.v5.min.js"></script>
<script src="/assets/sbt.js"></script>
<script type="text/x-mathjax-config">
    MathJax.Hub.Config({ TeX: { equationNumbers: {autoNumber: "AMS"} } });
</script>

