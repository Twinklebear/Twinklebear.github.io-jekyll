---
layout: post
title: "Volume Rendering with WebGL"
description: ""
category: webgl
tags: [webgl, javascript]
published: true
mathjax: true
---
{% include JB/setup %}

<figure>
	<img class="img-fluid" src="https://i.imgur.com/YqdyKCj.png"/>
	<figcaption><i>Fig. 1: Sample volumes CAP TODO</i></figcaption>
</figure>

In scientific visualization, volume rendering is used to visualize
3D scalar fields. These scalar fields are often
uniform grids of values, representing,
e.g., charge density around a molecule,
an MRI scan, air pressure around an airplane, etc.
Volume rendering is a conceptually straightforward method
for turning such data into an image: by sampling the data
along rays from the eye and picking
a color and transparency value for each sample, we can
produce useful and beautiful images of such scalar fields
(see e.g., Figure 1).
In a GPU renderer, these 3D scalar fields are stored
as 3D textures; however, in WebGL1 3D textures were
not supported. WebGL2 added support for 3D textures,
allowing for an elegant and fast volume renderer to be
implemented entirely in the browser.
In this post we'll discuss the mathematical background
for volume rendering, and how it can be implemented using
WebGL2 to create an
[interactive volume renderer](https://www.willusher.io/webgl-volume-raycaster/),
entirely in the browser!

<!--more-->

# 1. Introduction
To produce an image from volumetric data we need to model how light rays
are absorbed, scattered, and emitted by the medium. However,
a complete physically based model with scattering is typically too expensive for
interactive rendering. Instead, interactive scientific visualization applications
employ a simplified emission-absorption model, and ignore more expensive
effects such as scattering. In the emission-absorption model light
rays entering the eye from the volume pick up color emitted by the
medium, and are attenuated as they traverse it due to absorption. If we trace
rays from the eye through the volume, we can compute the color
returning back along the ray to the pixel with the following integral.

$$C(r) = \int_0^L C(s) \mu(s) e^{-\int_0^s \mu(t) dt} ds$$

At each point $$s$$ along the ray we sample the volume, and
accumulate the color $$C(s)$$ and absorption $$\mu(s)$$,
attenuated by the absorption along the ray between $$s$$
and the entry point of the volume ($$e^{-\int_0^s \mu(t) dt}$$).
In general this integral cannot be computed analytically, and
we must use a numeric approximation. To do so we take a set of $$N$$
samples along the ray, each a distance $$\Delta s$$ apart.

$$
	C(r) = \sum_{i=0}^N C(i \Delta s) \mu (i \Delta s) \Delta s
			\prod_{j=0}^{i-1} e^{-\mu(j \Delta s) \Delta s}
$$

We can apply a further simplification, and approximate the
attenuation term for each sample (the product of $$e^{-\mu(j \Delta s) \Delta s}$$ terms)
by it's Taylor series. This yields the well known front-to-back alpha
compositing algorithm.

$$
	C(r) = \sum_{i=0}^N C(i \Delta s) \alpha (i \Delta s)
			\prod_{j=0}^{i-1} (1 - \alpha(j \Delta s))
$$

In scientific visualization both the color, $$C(s)$$,
and opacity, $$\alpha(s)$$, of each sample are set by a
user-specified transfer function. The transfer function is
used to hide or accent areas of interest in the data,
for example to hide noise or background.
Our final volume raytracer then can iteratively step a ray front-to-back
through the volume, accumulating the color and opacity terms as
we go.

$$
	\hat{C}_i = \hat{C}_{i-1} + (1 - \alpha_{i-1}) \hat{C}(i \Delta s)
$$

$$
	\alpha_i = \alpha_{i - 1} + (1 - \alpha_{i-1}) \alpha(i \Delta s)
$$

Note that in these final equations we use pre-multiplied opacity for
correct interpolation, $$\hat{C}(i\Delta s) = C(i\Delta s) \alpha(i \Delta s)$$.

These equations amount to a for loop, where we step along the ray
for each pixel, and accumulate the color and opacity as we go.
This loop continues until the ray either leaves the volume,
or the accumulated color has become opaque ($$\alpha = 1$$).
Each pixel we process is independent, and needs read-only
access to our shared state (i.e., the volume). If we want
to compute the image quickly, we just need a way to process
a large amount of pixels executing the same instruction
on some different inputs. This is where the GPU comes in.
By implementing the above equation in a fragment shader,
we can implement a very fast volume renderer!

# 2. GPU Implementation with WebGL2

We need some geometry to give to the vertex part of the pipeline,
so that we can spawn the fragment shader work on the pixels that need
to render the volume. So we can have some lead in to why we want to
render the front and back faces of the box of the volume.
Can mention the hints of how this is similar to shadertoy,
where you schedule fragment shader execution by rendering
two triangles.

We can then discuss how we use this vertex part to create the
world-space eye rays and pass them to the fragment shader.
Maybe at this point insert a rendering of a cube shaded by the
eye ray direction?

