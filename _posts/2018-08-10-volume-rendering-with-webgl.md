---
layout: post
title: "Volume Rendering with WebGL"
description: ""
category: webgl
tags: [webgl, javascript]
published: false
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

We'll begin by briefly reviewing the basic OpenGL rendering pipeline,
then discuss how we can implement the above volume rendering equation
in this context.
The simplest OpenGL pipeline consists of two shader stages:
the vertex shader, responsible for transforming input triangle
vertices into the camera space *or is it NDC?*, and the fragment shader, responsible
for shading each pixel covered by the transformed triangle.

*Insert here a diagram of the pipeline*

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

*Maybe here have a figure showing that we raster
the faces to spawn work, then in the frag shader
run the ray marching*

To allow users to zoom fully in to the volume, we'll rasterize just
the back-faces of the box, by setting OpenGL's face culling to cull
front faces instead of back faces. We can also use the
vertex shader to compute the ray direction at each vertex
and let the GPU interpolate it for us, then in the fragment
shader we can normalize it and begin ray marching.
To illustrate the first step of our rendering process, the back
faces of the volume bounding box
are shown below, shaded by the ray direction.

*Insert the interactive rendering of the back faces shaded
by ray direction here*

Here is the vertex shader for rendering our bounding box:

and the fragment shader:

Now that we can run the fragment shader for pixels the volume
projects to and compute the eye

{% highlight glsl %}
#version 300 es
layout(location=0) in vec3 pos;
uniform mat4 proj_view;
uniform highp vec3 eye_pos;
uniform highp vec3 volume_scale;
out vec3 vray_dir;
flat out highp vec3 transformed_eye;
void main(void) {
	highp vec3 volume_translation = vec3(0.5) - volume_scale * 0.5;
	transformed_eye = (eye_pos - volume_translation) / volume_scale;
	// TODO: For non-uniform size volumes we need to transform them differently as well
	// to center them properly
	vray_dir = pos - transformed_eye;
	gl_Position = proj_view * vec4(pos * volume_scale + volume_translation, 1);
};
{% endhighlight %}

{% highlight glsl %}
#version 300 es
uniform highp sampler3D volume;
uniform highp sampler2D colormap;
uniform highp ivec3 volume_dims;
uniform highp vec3 eye_pos;
uniform highp float dt_scale;
in highp vec3 vray_dir;
flat in highp vec3 transformed_eye;
out highp vec4 color;

highp vec2 intersectBox(highp vec3 orig, highp vec3 dir) {
	const highp vec3 box_min = vec3(0);
	const highp vec3 box_max = vec3(1);
	highp vec3 inv_dir = 1.0 / dir;
	highp vec3 tmin_tmp = (box_min - orig) * inv_dir;
	highp vec3 tmax_tmp = (box_max - orig) * inv_dir;
	highp vec3 tmin = min(tmin_tmp, tmax_tmp);
	highp vec3 tmax = max(tmin_tmp, tmax_tmp);
	highp float t0 = max(tmin.x, max(tmin.y, tmin.z));
	highp float t1 = min(tmax.x, min(tmax.y, tmax.z));
	return vec2(t0, t1);
}

// TODO: This thing I think we should cut and discuss later in
// a subsection. Then show the final result?
// Pseudo-random number gen from
// http://www.reedbeta.com/blog/quick-and-easy-gpu-random-numbers-in-d3d11/
// with some tweaks for the range of values
highp float wang_hash(highp int seed) {
	seed = (seed ^ 61) ^ (seed >> 16);
	seed *= 9;
	seed = seed ^ (seed >> 4);
	seed *= 0x27d4eb2d;
	seed = seed ^ (seed >> 15);
	return float(seed % 2147483647) / float(2147483647);
}

void main(void) {
	highp vec3 ray_dir = normalize(vray_dir);
	highp vec2 t_hit = intersectBox(transformed_eye, ray_dir);
	if (t_hit.x > t_hit.y) {
		discard;
	}
	t_hit.x = max(t_hit.x, 0.0);
	highp vec3 dt_vec = 1.0 / (vec3(volume_dims) * abs(ray_dir));
	highp float dt = dt_scale * min(dt_vec.x, min(dt_vec.y, dt_vec.z));
	highp float offset = wang_hash(int(gl_FragCoord.x + 640.0 * gl_FragCoord.y));
	highp vec3 p = transformed_eye + (t_hit.x + offset * dt) * ray_dir;
	for (highp float t = t_hit.x; t < t_hit.y; t += dt) {
		highp float val = texture(volume, p).r;
		highp vec4 val_color = vec4(texture(colormap, vec2(val, 0.5)).rgb, val);+
		color.rgb += (1.0 - color.a) * val_color.a * val_color.rgb;
		color.a += (1.0 - color.a) * val_color.a;
		if (color.a >= 0.95) {
			break;
		}
		p += ray_dir * dt;
	}
};

{% endhighlight %}

