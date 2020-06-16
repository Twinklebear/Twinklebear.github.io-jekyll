---
layout: post
title: "From 0 to glTF with WebGPU: Bind Groups"
description: ""
category: graphics
tags: [graphics, webgpu]
published: true
---
{% include JB/setup %}

{% assign figurecount = 0 %}

<!--more-->


<div class="col-12 row">
    <div class="col-12 d-flex justify-content-center">
        <canvas id="webgpu-canvas" width="640" height="480"></canvas>
    </div>
    <div class="col-12 alert alert-danger" id="no-webgpu" style="display:none;">
        <h4>Error: Your browser does not support WebGPU</h4>
    </div>
    <div class="col-12">
        {% assign figurecount = figurecount | plus: 1 %}
        <figcaption><b>Figure {{figurecount}}:</b>
        <i>Our triangle, rendered with WebGPU.
        </i></figcaption>
    </div>
</div>

<script src="/assets/gl-matrix-min.js"></script>
<script src="/assets/webgl-util.min.js"></script>
<script src="/assets/webgpu/triangle_bind_groups.js"></script>

## Wrapping Up

