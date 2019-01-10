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
	Sample volumes CAP TODO</i></figcaption>
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

<figure>
	<img class="img-fluid" width="80%"
		src="/assets/img/webgl-volumes/cloud.svg"/>
	{% assign figurecount = figurecount | plus: 1 %}
	<figcaption><i>Fig. {{figurecount}}:
	Volume rendering.
	*TODO: a fig showing a cloud w/ emission, absorption and scattering*
	</i></figcaption>
</figure>


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

In these final equations we use pre-multiplied opacity for
correct interpolation, $$\hat{C}(i\Delta s) = C(i\Delta s) \alpha(i \Delta s)$$.
*Do I mean interpolation here? Or do i mean blending between samples?*

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

<figure>
	<img class="img-fluid" width="70%"
		src="/assets/img/webgl-volumes/raymarching-grid.svg"/>
	{% assign figurecount = figurecount | plus: 1 %}
	<figcaption><i>Fig. {{figurecount}}:
	Raymarching the volume grid.
	</i></figcaption>
</figure>


# 2. GPU Implementation with WebGL2

We'll begin by briefly reviewing the basic OpenGL rendering pipeline,
then discuss how we can implement the above volume rendering equation
in this context.
The simplest OpenGL pipeline in WebGL consists of two shader stages:
the vertex shader, responsible for transforming input triangle
vertices into clip space, and the fragment shader, responsible
for shading each pixel covered by the transformed triangle.

<figure>
	<img class="img-fluid"
		src="/assets/img/webgl-volumes/webgl-triangle-pipeline.svg"/>
	{% assign figurecount = figurecount | plus: 1 %}
	<figcaption><i>Fig. {{figurecount}}:
	The WebGL pipeline for a single triangle.
	</i></figcaption>
</figure>


However, in the case of volume rendering we have a volume,
not a set of triangles. To get our volume data rendered we
have to either create some geometric representation of it,
or follow an approach like [Shader Toy]() where we use
some dummy geometry to spawn fragment processing. The former
option is known as slice-based rendering, and was used widely
before the growth of programmable GPUs. Our approach will
bear more resemblence to that of Shader Toy; however, to save
on some compute work we'll just rasterize the volume's bounding
box, instead of two full screen triangles. Rasterizing only
the bounding box will allow us to restrict the compute work
to just the pixels where the volume is visible. Then,
in the fragment shader we perform the volume ray marching
step described above.

<figure>
	<img class="img-fluid"
		src="/assets/img/webgl-volumes/webgl-volume-raycast-pipeline.svg"/>
	{% assign figurecount = figurecount | plus: 1 %}
	<figcaption><i>Fig. {{figurecount}}:
	Using the WebGL pipeline for raymarching a volume.
	</i></figcaption>
</figure>


To allow users to zoom fully in to the volume, we'll rasterize just
the back-faces of the box, by setting OpenGL's face culling to cull
front faces instead of back faces. We can also use the
vertex shader to compute the ray direction at each vertex
and let the GPU interpolate it for us, then in the fragment
shader we can normalize it and begin ray marching.
To illustrate the first step of our rendering process, the back
faces of the volume bounding box
are shown below, shaded by the ray direction.

<figure>
	<img class="img-fluid" width="70%" src="https://i.imgur.com/FMWE7UR.png"/>
	{% assign figurecount = figurecount | plus: 1 %}
	<figcaption><i>Fig. {{figurecount}}:
	Volume box back faces, colored by ray direction</i></figcaption>
</figure>

Here is the vertex shader for rendering our bounding box:

and the fragment shader:

Now that we can run the fragment shader for pixels the volume
projects to and compute the eye

<figure>
	<img class="img-fluid" width="80%" src="https://i.imgur.com/vtZqe4m.png"/>
	{% assign figurecount = figurecount | plus: 1 %}
	<figcaption><i>Fig. {{figurecount}}:
	Final rendered result, on the Bonsai</i></figcaption>
</figure>

{% highlight glsl %}
#version 300 es
layout(location=0) in vec3 pos;
uniform mat4 proj_view;
uniform vec3 eye_pos;
uniform vec3 volume_scale;

out vec3 vray_dir;
flat out vec3 transformed_eye;

void main(void) {
	// Need to note that we do this part b/c we draw a unit cube from [0, 1]
	// and want to scale it to match the volume dims, while translating the
	// eye params into the [0, 1] space so it's easy to raymarch and sample the texture
	vec3 volume_translation = vec3(0.5) - volume_scale * 0.5;
	transformed_eye = (eye_pos - volume_translation) / volume_scale;
	vray_dir = pos - transformed_eye;
	gl_Position = proj_view * vec4(pos * volume_scale + volume_translation, 1);
};
{% endhighlight %}

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

vec2 intersectBox(vec3 orig, vec3 dir) {
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
	vec2 t_hit = intersectBox(transformed_eye, ray_dir);
	if (t_hit.x > t_hit.y) {
		discard;
	}
	t_hit.x = max(t_hit.x, 0.0);
	vec3 dt_vec = 1.0 / (vec3(volume_dims) * abs(ray_dir));
	float dt = dt_scale * min(dt_vec.x, min(dt_vec.y, dt_vec.z));
	float offset = wang_hash(int(gl_FragCoord.x + 640.0 * gl_FragCoord.y));
	vec3 p = transformed_eye + (t_hit.x + offset * dt) * ray_dir;
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

