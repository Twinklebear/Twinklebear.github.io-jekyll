---
layout: post
title: "Faster Shadow Rays on RTX"
description: ""
category: graphics
tags: [graphics, raytracing]
published: true
---
{% include JB/setup %}

{% assign figurecount = 0 %}

To determine if a hit point can be directly lit by a light source in the scene
we need to perform a visibility test between the point and light.
In a path tracer we must perform at least one visibility test per hit point
to shade the surface, or two if we're using multiple importance sampling (one for the light
sample, and one for the BSDF sample). When rendering just ambient occlusion,
e.g., for baking occlusion maps, we may send even more shadow rays per hit-point.
Fortunately, shadow rays can be relatively cheap to trace, as
we don't care about finding the closest hit point or surface shading information,
but just whether or not something is intersected by the ray.
There are a few options and combinations of ray flags which we can use
when deciding how to trace shadow rays on RTX (through DXR, OptiX or Vulkan).
I recently learned a method for skipping all hit group shaders (any hit, closest hit)
and instead using just the miss shader to determine if the ray is *not* occluded.
This was a bit non-obvious to me, though has been used by others
(see [Chris Wyman's Intro to DXR](http://intro-to-dxr.cwyman.org/presentations/IntroDXR_ShaderTutorial.pdf)
and [Sascha Willems's NV Ray Tracing Shadows Example](https://github.com/SaschaWillems/Vulkan/tree/master/data/shaders/nv_ray_tracing_shadows)).
After switching to this approach in [ChameleonRT](https://github.com/Twinklebear/ChameleonRT)
I decided to run a small benchmark comparing some of the options for tracing shadow rays.
I'll also discuss an extra trick we can pull to simplify the shader binding table setup,
in the case that we're not using any alpha cutout textures.

<!--more-->


