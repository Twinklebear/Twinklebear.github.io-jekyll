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

