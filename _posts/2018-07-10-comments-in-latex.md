---
layout: post
title: "Comments in LaTeX"
description: ""
category: latex
tags: [latex]
published: true
---
{% include JB/setup %}

When writing a paper in LaTeX, it's common to leave
notes and comments in the text, either to yourself
or to discuss with your co-authors. I used to write these
as just differently colored text using `\textcolor{...}`,
with each author assigned a color, or all with the same color.
However, with more authors
it can get hard to keep picking legible font colors.
More recently, I've switched to using highlights for
the comments, which works well with multiple people,
and helps the comments stand out better from the rest of
the text. This is easy to do with the
[soul](https://ctan.org/pkg/soul?lang=en) and
[xcolor](https://ctan.org/pkg/xcolor?lang=en) packages.

<!--more-->

{% highlight latex %}
\usepackage{soul}
\usepackage[dvipsnames]{xcolor}

\DeclareRobustCommand{\will}[1]{\{\begingroup\sethlcolor{BurntOrange}\hl{(will:) #1}\endgroup\}}

{% endhighlight %}
