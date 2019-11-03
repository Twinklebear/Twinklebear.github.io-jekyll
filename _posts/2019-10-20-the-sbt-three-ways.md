---
layout: post
title: "The Shader Binding Table Three Ways"
description: ""
category: graphics
tags: [graphics, raytracing]
published: true
---
{% include JB/setup %}

Lead-in: some stuff like the SBT setup and how the different options for
tweaking how it's indexed can be confusing to work out. The information around
is a bit partial and most people are left to kind of work out the math or some
guess work to see what's going on. Here I'll explain each and provide an interactive
tool for playing with how the SBT is setup and indexed in the shader.
Also explain difference of a shader vs. the shader record, which is more like
a closure in that you need a SR for each unique combination of function and SBT parameters.

<!--more-->

# DirectX Ray Tracing

SBT can store pairs of 4byte constants (oe 4byte + pad) and 8 byte descriptors.
This appears as any other shader parameters and have to be mapped to the corresponding
registers/spaces etc. by specifying a local root signature for the shaders.

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

{% highlight c++ %}
typedef struct D3D12_RAYTRACING_INSTANCE_DESC {
  FLOAT                     Transform[3];
  UINT                      InstanceID : 24;
  UINT                      InstanceMask : 8;
  UINT                      InstanceContributionToHitGroupIndex : 24;
  UINT                      Flags : 8;
  D3D12_GPU_VIRTUAL_ADDRESS AccelerationStructure;
} D3D12_RAYTRACING_INSTANCE_DESC;
{% endhighlight %}

Shader handle size `D3D12_SHADER_IDENTIFIER_SIZE_IN_BYTES` (32), shader record
stride alignment `D3D12_RAYTRACING_SHADER_TABLE_BYTE_ALIGNMENT` (64). Interesting
to note here as well, the max size of the stride is 4096 bytes.

Can also talk about how the ray payload is sent here too in trace ray.

# Vulkan Ray Tracing

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

# OptiX

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
- view the dispatch rays desc with the stride/offset/etc. values
- multiple geom per-instance, see what the instance contribution should be for different
    ray types in the scene
- changing the trace ray parameters to see which hit groups are accessed for specific
    instances and geometries
- see which hit group is called for a specific geometry given the current indexing params
- see which miss group is called for a specific trace call
- maybe also include that it is possible to have multiple ray-gen shaders but the APIs
    just take the one to use for the current launch/dispatch as the param. You don't specify
    some table with stride.
- also show and talk about the instance mask and how this can be used
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
        <div class="col-12 mb-3">
            API: <select id="selectAPI" onchange="selectAPI()">
            <option selected="selected">DXR</option>
            <option>Vulkan</option>
            <option>OptiX</option>
            </select>
            Raygen Size: <span id='raygenSize'></span>,
            HitGroup Stride: <span id='hitGroupStride'></span>,
            Miss Shader Stride: <span id='missStride'></span>
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
                    <input type="number" class="form-control" id="structParamSize" min="0" placeholder="Struct size (bytes)">
                </div>
                <div class="col-4">
                    <button id="addStruct" type="button" class="btn btn-primary" onclick="addStructParam()">Add/Set Struct</button>
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
        Sent Recommended Offset</button>
    </div>
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
</div>

# Extra: An SBT for Embree

We can do the same thing with Embree since the whole code is in our control for
how calls get dispatched. So if we want a consistent API for ray tracing we can
actually implement an SBT for Embree as well. We could implement one that works
just like OptiX to prove an easy example.

<script src="https://d3js.org/d3.v5.min.js"></script>
<script src="/assets/sbt.js"></script>

