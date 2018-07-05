---
layout: post
title: "Volume Rendering with WebGL"
description: ""
category: webgl
tags: [webgl, javascript]
published: true
mathjax: false
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
along rays from the eye and applying
a color and transparency value to each point we can
produce useful and beautiful images of such scalar fields.
While previous WebGL1 implementations had to work around
the lack of 3D texture support, this is no longer
the case with WebGL2. Using WebGL2 we can implement
an elegant and fast volume renderer in the browser,
to deliver interactive volume visualization to users.
We'll discuss the mathematical background
for volume rendering, and how it can be implemented using
WebGL2 to create an
[interactive volume renderer](https://www.willusher.io/webgl-volume-raycaster/)
entirely in the browser!

<!--more-->

# 1. Introduction

What is volume rendering?

\\[
C(r) = \int_0^L C(s) \mu(s) e^{-\int_0^s \mu(t) dt} ds
\\]

# 1.1 WebGL 2

Something about recent 3D textures, maybe skip this entirely?

# 2. WebGL2 Implementation

