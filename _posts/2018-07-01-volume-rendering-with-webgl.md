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

Note that in this final equation we use pre-multiplied opacity for
correct interpolation, $$\hat{C}(i\Delta s) = C(i\Delta s) \alpha(i \Delta s)$$.

# 2. GPU Implementation with WebGL2

Now talk about the front/back face box rasterization, similarities to shadertoy
i guess for scheduling work on the GPU using the fragment shader.

