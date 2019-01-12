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

{% assign figurecount = 0 %}

<figure>
	<img class="img-fluid" src="https://i.imgur.com/YqdyKCj.png"/>
	{% assign figurecount = figurecount | plus: 1 %}
	<figcaption><i>Fig. {{figurecount}}:
	Example volume renderings, using the WebGL volume renderer described in this post.
	Left: A simulation of the spatial probability distribution
	of elections in a high potential protein molecule.
	Right: A CT scan of a Bonsai Tree.
	Both datasets are frome the
	<a href="https://klacansky.com/open-scivis-datasets/">Open SciVis Datasets</a>
	repository.
	</i></figcaption>
</figure>

In scientific visualization, volume rendering is used to visualize
3D scalar fields. These scalar fields are often
uniform grids of values, representing,
for example, charge density around a molecule,
an MRI scan, air pressure around an airplane, etc.
Volume rendering is a conceptually straightforward method
for turning such data into an image: by sampling the data
along rays from the eye and assigning
a color and transparency to each sample, we can
produce useful and beautiful images of such scalar fields
(see Figure 1).
In a GPU renderer, these 3D scalar fields are stored
as 3D textures; however, in WebGL1 3D textures were
not supported, requiring additional hacks to emulate them
for volume rendering.
Recently, WebGL2 added support for 3D textures,
allowing for an elegant and fast volume renderer to be
implemented entirely in the browser.
In this post we'll discuss the mathematical background
for volume rendering, and how it can be implemented using
WebGL2 to create an
[interactive volume renderer](https://www.willusher.io/webgl-volume-raycaster/),
entirely in the browser!

<!--more-->

# 1. Introduction

<figure>
	<img class="img-fluid" width="80%"
		src="/assets/img/webgl-volumes/volume-rendering-cloud.svg"/>
	{% assign figurecount = figurecount | plus: 1 %}
	<figcaption><i>Fig. {{figurecount}}:
	Physically based volume rendering, accounting for absorption and
	light emission by the volume, along with scattering effects.
	</i></figcaption>
</figure>

To produce a physically realistic image from volumetric data, we need to model how light rays
are absorbed, emitted, and scattered by the medium (Figure 2).
While modelling light transport through a medium at this level
produces beautiful, physically correct images, it is too expensive for
interactive rendering, which is our goal in visualization software.
In scientific visualization, our end goal is
to allow scientists to interactively explore their data, enabling them
to ask and answer questions about their research problem.
As a complete physically based model with scattering is too expensive
for interactive rendering, visualization applications
employ a simplified emission-absorption model, ignoring expensive
effects such as scattering, or approximating them in some manner.
Here we will just focus on the emission-absorption model.

In the emission-absorption model, we only compute the lighting effects
along the black arrow in Figure 2, and ignore effects from the dashed gray
ones. Rays passing through the volume and reaching the eye accumulate color emitted by the
volume, and are attenuated as they traverse it due to absorption by the volume.
If we trace rays from the eye through the volume, we can
compute they light received at the eye by integrating the ray through
the volume, to accumulate the emission and absorption along the ray.
Given a ray from the eye which enters the volume at $$s = 0$$ and exits it at
$$s = L$$, we can compute the light which
is received at the eye using the following integral:

$$
C(r) = \int_0^L C(s) \mu(s) e^{-\int_0^s \mu(t) dt} ds
$$

As the ray passes through the volume, we integrate over it
to accumulate the emitted color $$C(s)$$ and absorption $$\mu(s)$$
through the volume. The emitted color at each point is attenuated as it returns
to the eye by the volume's absorption, which we compute with the
$$e^{-\int_0^s \mu(t) dt}$$ term, which computes the absorption from
the entry point to the current point $$s$$.

In general, this integral cannot be computed analytically and
we must use a numeric approximation. To do so we take a set of $$N$$
samples along the ray on the interval $$s = [0, L]$$, each a distance $$\Delta s$$ apart
(labelled in Figure 3), and sum them together. The attenuation term at
each sample point becomes a product series, accumulating the absorption at
previous samples.

$$
	C(r) = \sum_{i=0}^N C(i \Delta s) \mu (i \Delta s) \Delta s
			\prod_{j=0}^{i-1} e^{-\mu(j \Delta s) \Delta s}
$$

To simplify this sum further, we approximate the
previous samples's attenuation terms  ($$e^{-\mu(j \Delta s) \Delta s}$$)
by their Taylor series. We also introduce the alpha term,
$$\alpha(i \Delta s) = \mu(i \Delta s) \Delta s$$,
for convenience. This yields the well known front-to-back alpha compositing equation:

$$
	C(r) = \sum_{i=0}^N C(i \Delta s) \alpha (i \Delta s)
			\prod_{j=0}^{i-1} (1 - \alpha(j \Delta s))
$$

<figure>
	<img class="img-fluid" width="80%"
		src="/assets/img/webgl-volumes/volume-rendering-cloud-labelled.svg"/>
	{% assign figurecount = figurecount | plus: 1 %}
	<figcaption><i>Fig. {{figurecount}}:
	Computing the emission-absorption rendering integral on a volume.
	</i></figcaption>
</figure>

The above equation amounts to a for loop, where we step the ray through
the volume, and accumulate the color and opacity iteratively as we go.
This loop continues until the ray either leaves the volume,
or the accumulated color has become opaque ($$\alpha = 1$$).
The iterative computation of the above sum is done using the familiar
front-to-back compositing equations:

$$
	\hat{C}_i = \hat{C}_{i-1} + (1 - \alpha_{i-1}) \hat{C}(i \Delta s)
$$

$$
	\alpha_i = \alpha_{i - 1} + (1 - \alpha_{i-1}) \alpha(i \Delta s)
$$

In these final equations we use pre-multiplied opacity for
correct blending, $$\hat{C}(i\Delta s) = C(i\Delta s) \alpha(i \Delta s)$$.

To render an image of the volume we just need to trace a ray
from the eye through each pixel, and perform the above
iteration for each ray intersecting the volume.
Each ray we process is independent, and needs read-only
access to our shared state (the volume). If we want
to compute the image quickly, all we need is a way to process
a large number of pixels in parallel.
This is where the GPU comes in.
By implementing the raymarching process in a fragment shader
we can leverage the parallel computing power of the GPU to
implement a very fast volume renderer!

<!--
**Todo: mention that the volume represents a continous field,
so when we sample along the grid we'll do trilinear interpolation to
get the sample value**
<figure>
	<img class="img-fluid" width="70%"
		src="/assets/img/webgl-volumes/raymarching-grid.svg"/>
	{% assign figurecount = figurecount | plus: 1 %}
	<figcaption><i>Fig. {{figurecount}}:
	Raymarching the volume grid.
	</i></figcaption>
</figure>
-->

# 2. GPU Implementation with WebGL2

To run our raymarching work in the fragment shader, we need
to get the GPU to run the fragment shader for the pixels we want
to trace rays through.
However, the OpenGL pipeline works on geometric primitives (Figure 5),
and does not have a direct method to run fragment processing on
some region of the screen.
To work around this, we can render some proxy geometry to schedule the fragment
processing we want.
Our approach to rendering the volume will be
similar to those of [Shader Toy](https://www.shadertoy.com/)
and [demoscene renderers](https://iquilezles.org/www/material/nvscene2008/nvscene2008.htm),
which render two full-screen triangles to spawn
fragment processing, and do the real rendering work
in the fragment shader.

<figure>
	<img class="img-fluid"
		src="/assets/img/webgl-volumes/webgl-triangle-pipeline.svg"/>
	{% assign figurecount = figurecount | plus: 1 %}
	<figcaption><i>Fig. {{figurecount}}:
	The OpenGL pipeline in WebGL consists of two programmable shader stages:
	the vertex shader, responsible for transforming input triangle
	vertices into clip space, and the fragment shader, responsible
	for shading each pixel covered by the transformed triangle.
	</i></figcaption>
</figure>

While rendering two full-screen triangles as in ShaderToy will work, it would run
an unnecessary amount of fragment processing in the case that the
volume does not cover the entire screen. This case is actually
quite common, as users get an overview of the dataset or study
large-scale features. To restrict the fragment processing work
to just those pixels touched by the volume, we can rasterize
the bounding box of the volume grid, and then run the raymarching
step in the fragment shader. Finally, we don't want to render
both the front and back faces of the box,
since we'll end up running the same work twice. Furthermore,
if we render the front faces we'll run into clipping issues
when the user zooms in to the volume, as the front faces will
project behind the camera and be clipped. To allow users to
zoom fully into the volume, we'll render just the back faces of
the box. Our resulting rendering pipeline is shown in Figure 6.

<figure>
	<img class="img-fluid"
		src="/assets/img/webgl-volumes/webgl-volume-raycast-pipeline.svg"/>
	{% assign figurecount = figurecount | plus: 1 %}
	<figcaption><i>Fig. {{figurecount}}:
	The WebGL pipeline for raymarching a volume. We rasterize
	the backfaces of the volume's bounding box to spawn
	fragment processing work for those pixels touched by the volume.
	Within the fragment shader we march rays through the volume
	to render it.
	</i></figcaption>
</figure>

In this pipeline, the bulk of real rendering work is done in the
fragment shader; however, we can still use the vertex shader and
the fixed function interpolation hardware for some useful computation.
Our vertex shader will transform the volume based on the user's camera
position, and compute for us the ray direction and eye position
in the volume space, and pass them to the fragment direction.
The ray direction computed at each vertex is then interpolated
across the triangle for us by the fixed function interpolation
hardware on the GPU, letting us compute the ray directions for
each fragment a bit cheaper. However, these directions
may not be normalized when we get them in the fragment
shader, so we'll still need to normalize them.

We'll render the bounding box as a unit cube  $$[0, 1]$$
cube, and scale it by the volume axes to support non-uniform sized
volumes. The eye position is transformed into the unit cube,
and the ray direction is computed in this space. Ray marching in
the unit cube space will allow us to simplify our texture sampling
operations during the ray marching, since we'll already be in the
$$[0, 1]$$ texture coordinate space for the 3D volume.

The vertex shader we'll use is shown below, the rasterized
back faces colored by the view ray direction is shown in Figure 7.

{% highlight glsl %}
#version 300 es
layout(location=0) in vec3 pos;
uniform mat4 proj_view;
uniform vec3 eye_pos;
uniform vec3 volume_scale;

out vec3 vray_dir;
flat out vec3 transformed_eye;

void main(void) {
	// Translate the cube to center it at the origin.
	vec3 volume_translation = vec3(0.5) - volume_scale * 0.5;
	gl_Position = proj_view * vec4(pos * volume_scale + volume_translation, 1);

	// Compute eye position and ray directions in the unit cube space
	transformed_eye = (eye_pos - volume_translation) / volume_scale;
	vray_dir = pos - transformed_eye;
};
{% endhighlight %}

<figure>
	<img class="img-fluid" width="70%" src="https://i.imgur.com/FMWE7UR.png"/>
	{% assign figurecount = figurecount | plus: 1 %}
	<figcaption><i>Fig. {{figurecount}}:
	The volume bounding box back faces, colored by ray direction</i></figcaption>
</figure>

**Now let's implement the raymarching in the fragment shader to
process each eye ray in parallel**
and the fragment shader:

Now that we can run the fragment shader for pixels the volume
projects to and compute the eye

In scientific visualization both the color, $$C(s)$$,
and opacity, $$\alpha(s)$$, of each sample are set by a
user-specified transfer function. The transfer function is
used to hide or accent areas of interest in the data,
for example to hide noise or background.

{% highlight glsl %}
#version 300 es
precision highp int;
precision highp float;
uniform highp sampler3D volume;
uniform highp sampler2D colormap;
uniform ivec3 volume_dims;
uniform vec3 eye_pos;
uniform float dt_scale;

in vec3 vray_dir;
flat in vec3 transformed_eye;

out vec4 color;

vec2 intersect_box(vec3 orig, vec3 dir) {
	const vec3 box_min = vec3(0);
	const vec3 box_max = vec3(1);
	vec3 inv_dir = 1.0 / dir;
	vec3 tmin_tmp = (box_min - orig) * inv_dir;
	vec3 tmax_tmp = (box_max - orig) * inv_dir;
	vec3 tmin = min(tmin_tmp, tmax_tmp);
	vec3 tmax = max(tmin_tmp, tmax_tmp);
	float t0 = max(tmin.x, max(tmin.y, tmin.z));
	float t1 = min(tmax.x, min(tmax.y, tmax.z));
	return vec2(t0, t1);
}

void main(void) {
	vec3 ray_dir = normalize(vray_dir);
	vec2 t_hit = intersect_box(transformed_eye, ray_dir);
	if (t_hit.x > t_hit.y) {
		discard;
	}
	t_hit.x = max(t_hit.x, 0.0);
	vec3 dt_vec = 1.0 / (vec3(volume_dims) * abs(ray_dir));
	float dt = dt_scale * min(dt_vec.x, min(dt_vec.y, dt_vec.z));
	vec3 p = transformed_eye + t_hit.x * ray_dir;
	for (float t = t_hit.x; t < t_hit.y; t += dt) {
		float val = texture(volume, p).r;
		vec4 val_color = vec4(texture(colormap, vec2(val, 0.5)).rgb, val);
		color.rgb += (1.0 - color.a) * val_color.a * val_color.rgb;
		color.a += (1.0 - color.a) * val_color.a;
		if (color.a >= 0.95) {
			break;
		}
		p += ray_dir * dt;
	}
}
{% endhighlight %}


<figure>
	<img class="img-fluid" width="80%" src="https://i.imgur.com/vtZqe4m.png"/>
	{% assign figurecount = figurecount | plus: 1 %}
	<figcaption><i>Fig. {{figurecount}}:
	Final rendered result, on the Bonsai, from the same
	viewpoint as in Figure 7.
	</i></figcaption>
</figure>

