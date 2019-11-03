var API = {
    'DXR': {
        SHADER_IDENTIFIER_SIZE: 32,
        SHADER_TABLE_BYTE_ALIGNMENT: 64,
    },
    'Vulkan': {
        SHADER_IDENTIFIER_SIZE: 16,
        SHADER_TABLE_BYTE_ALIGNMENT: 64,
    },
    'OptiX': {
        SHADER_IDENTIFIER_SIZE: 32,
        SHADER_TABLE_BYTE_ALIGNMENT: 16,
    },
};

var ParamType = {
    STRUCT: 1,
    FOUR_BYTE_CONSTANT: 2,
    FOUR_BYTE_CONSTANT_PAD: 3,
    GPU_HANDLE: 4,
};

var currentAPI = API['DXR'];

var shaderTable = null;
var selectedShaderRecord = null;

var sbtWidget = null;
var sbtWidgetScale = d3.scaleLinear([0, 32], [0, 78]);

var shaderRecordWidget = null;
var shaderRecordZoom = null;
var shaderRecordZoomRect = null;

var optixStructSizeInput = null;
var instanceGeometryCountUI = null;
var sbtOffsetUI = null;
var instanceMaskUI = null;

var dxrUI = null;
var vulkanUI = null;
var optixUI = null;

var traceParams = {
    raySBTOffset: 0,
    raySBTStride: 1,
    missShaderIndex: 0,
    rayInstanceMask: 0xff,
};

// Each instance is just a count of how many geometries it has,
// for D3 nesting we make this just an array like [0, 1, 2]
var instances = [];
var instanceWidget = null;
var instanceContainer = null;
var selectedInstance = 0;

var alignTo = function(val, align) {
    return Math.floor((val + align - 1) / align) * align;
}

var makeTriangle = function() {
    return d3.create('svg:polygon')
        .attr('points', '25 7.5, 50 50, 0 50')
        .attr('class', 'triangle')
        .attr('stroke', 'gray')
        .attr('stroke-width', 2)
        .attr('fill', 'black')
        .node();
}

var makeBLASIcon = function() {
    var n = d3.create('svg:g')
        .attr('class', 'blas');
    n.append('rect')
        .attr('width', 100)
        .attr('height', 100)
        .attr('fill', 'white')
        .attr('stroke-width', 2)
        .attr('stroke', 'black');
    n.append('rect')
        .attr('width', 35)
        .attr('height', 100)
        .attr('fill', 'lightblue')
        .attr('fill-opacity', 0.5)
        .attr('stroke-width', 2)
        .attr('stroke', 'blue');
    n.append('rect')
        .attr('x', 20)
        .attr('y', 20)
        .attr('width', 80)
        .attr('height', 50)
        .attr('fill', 'lightgreen')
        .attr('fill-opacity', 0.5)
        .attr('stroke-width', 2)
        .attr('stroke', 'green');
    return n.node();
}

var baseSBTOffset = function(inst) {
    // Compute the base SBT offset recommended for the instance,
    // not including additional stride due to multiple ray types
    var offset = 0;
    for (var i = 0; i < inst; ++i) {
        offset += instances[i].numGeometries();
    }
    return offset * traceParams.raySBTStride;
}

var ShaderParam = function(paramType, paramSize) {
    this.type = paramType;
    if (this.type == ParamType.STRUCT) {
        this.size = paramSize;
    } else if (this.type == ParamType.FOUR_BYTE_CONSTANT || this.type == ParamType.FOUR_BYTE_CONSTANT_PAD) {
        this.size = 4;
    } else if (this.type == ParamType.GPU_HANDLE) {
        this.size = 8;
    } else {
        alert('Unrecognized ParamType');
    }
}

var ShaderRecord = function(name) {
    this.params = [];
    this.name = name;
    this.baseOffset = 0;
    // True if the user modified this instance's SBT offset, in which case we won't auto-change it
    this.userSBTOffset = false;
}

ShaderRecord.prototype.addParam = function(param) {
    if (currentAPI == API['DXR']) {
        if (param.type == ParamType.GPU_HANDLE) {
            this.params.push(param);
        } else if (param.type == ParamType.FOUR_BYTE_CONSTANT) {
            if (this.params.length == 0 || this.params[this.params.length - 1].type != ParamType.FOUR_BYTE_CONSTANT_PAD) {
                this.params.push(param);
                // DXR requires 4 byte constants to be set in pairs, so insert a padding value
                // until another constant is inserted
                this.params.push(new ShaderParam(ParamType.FOUR_BYTE_CONSTANT_PAD));
            } else {
                this.params[this.params.length - 1] = param;
            }
        } else {
            alert('Only GPU handles and 4byte constants are supported for DXR');
        }
    } else if (currentAPI == API['Vulkan']) {
        if (param.type == ParamType.FOUR_BYTE_CONSTANT) {
            this.params.push(param);
        } else {
            alert('Only 4byte constants are support for Vulkan');
        }
    } else if (currentAPI == API['OptiX']) {
        if (param.type == ParamType.STRUCT) {
            if (this.params.length == 0) {
                this.params.push(param);
            } else {
                this.params[0] = param;
            }
        } else {
            alert('Only struct params are valid for OptiX');
        }
    } else {
        alert('Unrecognized API');
    }
}

ShaderRecord.prototype.setBaseOffset = function(baseOffset) {
    this.baseOffset = baseOffset;
}

ShaderRecord.prototype.size = function() {
    var size = 0;
    // Note: for optix we can only have one param, and it's a single struct 
    // of user-configurable data/size/etc.
    for (var i = 0; i < this.params.length; ++i) {
        size += this.params[i].size;
    }
    return currentAPI.SHADER_IDENTIFIER_SIZE + size;
}

ShaderRecord.prototype.removeParam = function(i) { 
    if (this.params[i].type == ParamType.FOUR_BYTE_CONSTANT_PAD) {
        return;
    }
    var toErase = 1;

    // If the param was a padded 4byte constant, the padding is also no longer needed
    if (i != this.params.length - 1 && this.params[i].type == ParamType.FOUR_BYTE_CONSTANT
        && this.params[i + 1].type == ParamType.FOUR_BYTE_CONSTANT_PAD) {
        toErase = 2;
    }

    this.params.splice(i, toErase);

    // For DXR: make sure no single 4byte constant entries are left in the SBT,
    // since they must come in pairs or with a 4byte padding
    if (currentAPI == API['DXR']) {
        // Remove and re-create any required 4byte padding to update the record
        for (var j = 0; j < this.params.length;) {
            if (this.params[j].type == ParamType.FOUR_BYTE_CONSTANT_PAD) {
                this.params.splice(j, 1);
            } else {
                ++j;
            }
        }
        // Now re-insert 4byte constant padding as necessary
        for (var j = 0; j < this.params.length; ++j) {
            if (this.params[j].type == ParamType.FOUR_BYTE_CONSTANT) {
                if (j == this.params.length - 1 || this.params[j + 1].type != ParamType.FOUR_BYTE_CONSTANT) {
                    this.params.splice(j + 1, 0, new ShaderParam(ParamType.FOUR_BYTE_CONSTANT_PAD));
                }
                // We either have or just made a pair, so skip the pair
                ++j;
            }
        }
    }

    updateViews();
}

ShaderRecord.prototype.render = function() {
    var self = this;
    optixStructSizeInput.value = '';

    shaderRecordWidget.select('.shaderRecordDetail').remove();
    var widget = shaderRecordWidget.append('g')
        .attr('class', 'shaderRecordDetail')
        .attr('transform', 'translate(32, 140)');

    var selection = widget.selectAll('.shaderRecordTitle').data([this]);
    selection.enter()
        .append('text')
        .attr('class', 'shaderRecordTitle')
        .merge(selection)
        .text(function(d) {
            return 'Shader Record: ' + d.name + ' at ' + self.baseOffset +
                ", Size: " + d.size() + "b";
        });
    selection.exit().remove();

    var scale = d3.scaleLinear([0, this.size()], [0, this.size() * 6]);

    selection = widget.selectAll('.shaderRecordHandle').data([this]);
    selection.enter()
        .append('rect')
        .attr('class', 'shaderRecordHandle')
        .attr('y', 8)
        .attr('height', 180)
        .attr('stroke-width', 2)
        .attr('stroke', 'black')
        .attr('fill', 'lightgray')
        .merge(selection)
        .attr('width', scale(currentAPI.SHADER_IDENTIFIER_SIZE));
    selection.exit().remove();

    selection = widget.selectAll('.shaderRecordHandleText').data([this]);
    selection.enter()
        .append('text')
        .attr('class', 'shaderRecordHandleText')
        .attr('transform', 'rotate(-90)')
        .attr('dominant-baseline', 'middle')
        .attr('y', scale(currentAPI.SHADER_IDENTIFIER_SIZE / 2.0))
        .attr('x', -180)
        .merge(selection)
        .text('Shader Identifier');
    selection.exit().remove();

    var offset = currentAPI.SHADER_IDENTIFIER_SIZE;
    selection = widget.selectAll('.shaderRecordParam').data(this.params);
    selection.enter()
        .append('rect')
        .attr('class', 'shaderRecordParam')
        .attr('y', 8)
        .attr('height', 180)
        .attr('stroke-width', 2)
        .attr('stroke', 'gray')
        .merge(selection)
        .attr('fill', function(d) {
            if (d.type == ParamType.STRUCT) {
                optixStructSizeInput.value = d.size;
                return 'yellow';
            }
            if (d.type == ParamType.FOUR_BYTE_CONSTANT) {
                return 'lightblue'
            }
            if (d.type == ParamType.FOUR_BYTE_CONSTANT_PAD) {
                return 'lightgray'
            }
            if (d.type == ParamType.GPU_HANDLE) {
                return 'lightgreen';
            }
            return 'gray';
        })
        .attr('width', function(d) {
            return scale(d.size);
        })
        .attr('x', function(d) {
            var pos = offset;
            offset += d.size;
            return scale(pos);
        })
        .on('dblclick', function(d, i) {
            self.removeParam(i);
            updateViews();
        });
    selection.exit().remove();

    offset = currentAPI.SHADER_IDENTIFIER_SIZE;
    selection = widget.selectAll('.shaderRecordParamText').data(this.params);
    selection.enter()
        .append('text')
        .attr('class', 'shaderRecordParamText')
        .attr('transform', 'rotate(-90)')
        .attr('dominant-baseline', 'middle')
        .attr('y', function(d) {
            var pos = offset + d.size / 2.0;
            offset += d.size;
            return scale(pos);
        })
        .attr('x', -180)
        .merge(selection)
        .text(function(d) {
            if (d.type == ParamType.STRUCT) {
                return 'Struct (' + d.size + 'b)';
            }
            if (d.type == ParamType.FOUR_BYTE_CONSTANT) {
                return '4-byte Constant'
            }
            if (d.type == ParamType.FOUR_BYTE_CONSTANT_PAD) {
                return '4-byte Pad'
            }
            if (d.type == ParamType.GPU_HANDLE) {
                return 'GPU Handle';
            }
            return 'Unknown??';
        })
        .on('dblclick', function(d, i) {
            self.removeParam(i);
            updateViews();
        });
    selection.exit().remove();

    offset = currentAPI.SHADER_IDENTIFIER_SIZE;
    var tickValues = [0];
    for (var i = 0; i < this.params.length; ++i) {
        tickValues.push(offset);
        offset += this.params[i].size;
    }
    tickValues.push(offset);
    var byteAxis = d3.axisBottom(scale).tickValues(tickValues);
    widget.append('g').attr('transform', 'translate(0, 188)').call(byteAxis);
}

var ShaderTable = function() {
    var sampleHG = new ShaderRecord('hitgroup');
    var sampleMiss = new ShaderRecord('miss');

    this.raygen = new ShaderRecord('raygen');
    this.hitGroups = [sampleHG];
    this.missShaders = [sampleMiss];

    this.hgOffset = 0;
    this.hgStride = 0;

    this.missOffset = 0;
    this.missStride = 0;

    selectedShaderRecord = this.raygen;
}

ShaderTable.prototype.clearParams = function() {
    this.raygen.params = [];
    for (var i = 0; i < this.hitGroups.length; ++i) {
        this.hitGroups[i].params = [];
    }
    for (var i = 0; i < this.missShaders.length; ++i) {
        this.missShaders[i].params = [];
    }
}

ShaderTable.prototype.size = function() {
    var raygenSize = alignTo(this.raygen.size(), currentAPI.SHADER_TABLE_BYTE_ALIGNMENT);
    document.getElementById('raygenSize').innerHTML = raygenSize + 'b';

    this.hgOffset = raygenSize;
    this.hgStride = 0;
    for (var i = 0; i < this.hitGroups.length; ++i) {
        this.hgStride = Math.max(this.hgStride, alignTo(this.hitGroups[i].size(), currentAPI.SHADER_TABLE_BYTE_ALIGNMENT)); 
    }

    document.getElementById('hitGroupStride').innerHTML = this.hgStride + 'b';
    document.getElementById('hitGroupOffset').innerHTML = this.hgOffset + 'b';

    this.missOffset = this.hgOffset + this.hgStride * this.hitGroups.length;
    this.missStride = 0;
    for (var i = 0; i < this.missShaders.length; ++i) {
        this.missStride = Math.max(this.missStride, alignTo(this.missShaders[i].size(), currentAPI.SHADER_TABLE_BYTE_ALIGNMENT)); 
    }
    document.getElementById('missStride').innerHTML = this.missStride + 'b';
    document.getElementById('missOffset').innerHTML = this.missOffset + 'b';

    return raygenSize + this.hgStride * this.hitGroups.length + this.missStride * this.missShaders.length;
}

ShaderTable.prototype.render = function() {
    var self = this;
    // Update strides and offsets
    this.size();

    // Draw the raygen program
    var raygenSelection = sbtWidget.selectAll('.raygen').data([this.raygen]);
    raygenSelection.enter()
        .append('rect')
        .attr('class', 'raygen')
        .attr('x', 0)
        .attr('y', 30)
        .attr('height', 64)
        .attr('stroke-width', 2)
        .attr('stroke', 'black')
        .attr('fill', 'white')
        .merge(raygenSelection)
        .on('mouseover', function(d) {
            d3.select(this).style('cursor', 'pointer');
        })
        .on('mouseout', function(d) {
            d3.select(this).style('cursor', 'default');
        })
        .on('click', function(d) {
            selectedShaderRecord = d;
            d.render();
        })
        .attr('width', sbtWidgetScale(this.raygen.size()));

    raygenSelection.exit().remove();

    var rgTextSelection = sbtWidget.selectAll('.rgText').data([this.raygen]);
    rgTextSelection.enter()
        .append('text')
        .attr('class', 'rgText')
        .attr('y', 62)
        .attr('dominant-baseline', 'middle')
        .attr('text-anchor', 'middle')
        .text('RG')
        .merge(rgTextSelection)
        .attr('x', sbtWidgetScale(this.raygen.size() / 2.0))
        .on('mouseover', function(d) {
            d3.select(this).style('cursor', 'pointer');
        })
        .on('mouseout', function(d) {
            d3.select(this).style('cursor', 'default');
        })
        .on('click', function(d) {
            selectedShaderRecord = d;
            d.render();
        });
    rgTextSelection.exit().remove();

    var instanceHgRange = instances[selectedInstance].hitGroupRange();

    var hgSelection = sbtWidget.selectAll('.hitgroup').data(this.hitGroups);
    hgSelection.enter()
        .append('rect')
        .attr('class', 'hitgroup')
        .attr('y', 30)
        .attr('height', 64)
        .attr('stroke-width', 2)
        .attr('stroke', 'black')
        .on('mouseover', function(d) {
            d3.select(this).style('cursor', 'pointer');
        })
        .on('mouseout', function(d) {
            d3.select(this).style('cursor', 'default');
        })
        .merge(hgSelection)
        .attr('fill', function(d, i) {
            if (i >= instanceHgRange[0] && i <= instanceHgRange[1]) {
                return 'lightblue';
            }
            return 'blue'
        })
        .on('click', function(d, i) {
            selectedShaderRecord = d;
            d.render();
        })
        .on('dblclick', function(d, i) {
            if (self.hitGroups.length == 1) {
                return;
            }
            self.hitGroups.splice(i, 1);

            if (selectedShaderRecord == d) {
                if (i < self.hitGroups.length) {
                    selectedShaderRecord = self.hitGroups[i]
                } else {
                    selectedShaderRecord = self.hitGroups[self.hitGroups.length - 1];
                }
            }

            // Reset the zoom for the shader record
            shaderRecordZoomRect.call(shaderRecordZoom.transform, d3.zoomIdentity);
            updateViews();
        })
        .attr('x', function(d, i) {
            var pos = self.hgStride * i + self.hgOffset;
            d.setBaseOffset(pos);
            return sbtWidgetScale(pos);
        })
        .attr('width', function(d) {
            return sbtWidgetScale(d.size());
        });

    hgSelection.exit().remove();

    var hgTextSelection = sbtWidget.selectAll('.hgText').data(this.hitGroups)
    hgTextSelection.enter()
        .append('text')
        .attr('class', 'hgText')
        .attr('y', 62)
        .attr('dominant-baseline', 'middle')
        .attr('text-anchor', 'middle')
        .text('HG')
        .merge(hgTextSelection)
        .attr('x', function(d, i) {
            var pos = self.hgStride * i + self.hgOffset;
            return sbtWidgetScale(pos + d.size() / 2.0);
        })
        .on('mouseover', function(d) {
            d3.select(this).style('cursor', 'pointer');
        })
        .on('mouseout', function(d) {
            d3.select(this).style('cursor', 'default');
        })
        .merge(hgSelection)
        .on('click', function(d, i) {
            selectedShaderRecord = d;
            d.render();
        })
        .on('dblclick', function(d, i) {
            if (self.hitGroups.length == 1) {
                return;
            }
            self.hitGroups.splice(i, 1);

            if (selectedShaderRecord == d) {
                if (i < self.hitGroups.length) {
                    selectedShaderRecord = self.hitGroups[i]
                } else {
                    selectedShaderRecord = self.hitGroups[self.hitGroups.length - 1];
                }
            }

            // Reset the zoom for the shader record
            shaderRecordZoomRect.call(shaderRecordZoom.transform, d3.zoomIdentity);
            updateViews();
        });
    hgTextSelection.exit().remove();

    var missSelection = sbtWidget.selectAll('.miss').data(this.missShaders);
    missSelection.enter()
        .append('rect')
        .attr('class', 'miss')
        .attr('y', 30)
        .attr('height', 64)
        .attr('stroke-width', 2)
        .attr('stroke', 'black')
        .on('mouseover', function(d) {
            d3.select(this).style('cursor', 'pointer');
        })
        .on('mouseout', function(d) {
            d3.select(this).style('cursor', 'default');
        })
        .merge(missSelection)
        .attr('fill', function(d, i) {
            if (i == traceParams.missShaderIndex) {
                return 'salmon';
            }
            return 'red';
        })
        .on('click', function(d, i) {
            selectedShaderRecord = d;
            d.render();
        })
        .on('dblclick', function(d, i) {
            if (self.missShaders.length == 1) {
                return;
            }
            self.missShaders.splice(i, 1);

            if (selectedShaderRecord == d) {
                if (i < self.missShaders.length) {
                    selectedShaderRecord = self.missShaders[i]
                } else {
                    selectedShaderRecord = self.missShaders[self.missShaders.length - 1];
                }
            }

            // Reset the zoom for the shader record
            shaderRecordZoomRect.call(shaderRecordZoom.transform, d3.zoomIdentity);
            updateViews();
        })
        .attr('x', function(d, i) {
            var pos = self.missStride * i + self.missOffset;
            d.setBaseOffset(pos);
            return sbtWidgetScale(pos);
        })
        .attr('width', function(d) {
            return sbtWidgetScale(d.size());
        });

    missSelection.exit().remove();

    var missTextSelection = sbtWidget.selectAll('.missText').data(this.missShaders)
    missTextSelection.enter()
        .append('text')
        .attr('class', 'missText')
        .attr('y', 62)
        .attr('dominant-baseline', 'middle')
        .attr('text-anchor', 'middle')
        .text('Miss')
        .merge(missTextSelection)
        .attr('x', function(d, i) {
            var pos = self.missStride * i + self.missOffset;
            return sbtWidgetScale(pos + d.size() / 2.0);
        })
        .on('mouseover', function(d) {
            d3.select(this).style('cursor', 'pointer');
        })
        .on('mouseout', function(d) {
            d3.select(this).style('cursor', 'default');
        })
        .on('click', function(d, i) {
            selectedShaderRecord = d;
            d.render();
        })
        .on('dblclick', function(d, i) {
            if (self.missShaders.length == 1) {
                return;
            }
            self.missShaders.splice(i, 1);

            if (selectedShaderRecord == d) {
                if (i < self.missShaders.length) {
                    selectedShaderRecord = self.missShaders[i]
                } else {
                    selectedShaderRecord = self.missShaders[self.missShaders.length - 1];
                }
            }

            // Reset the zoom for the shader record
            shaderRecordZoomRect.call(shaderRecordZoom.transform, d3.zoomIdentity);
            updateViews();
        });
    missTextSelection.exit().remove();
}

var Geometry = function(instance) {
    this.instance = instance;
}

var Instance = function() {
    this.geometries = [new Geometry(this)];
    this.mask = 0xff;
    this.sbtOffset = 0;
}

Instance.prototype.setNumGeometries = function(n) {
    var self = this;
    this.geometries = Array.apply(null, {length: n})
        .map(Function.call, function() { return new Geometry(self); });
}

Instance.prototype.numGeometries = function() {
    return this.geometries.length;
}

Instance.prototype.hitgroupForGeometry = function(geomIdx) {
    return traceParams.raySBTOffset + traceParams.raySBTStride * geomIdx + this.sbtOffset;
}

Instance.prototype.hitGroupRange = function() {
    return [traceParams.raySBTOffset + this.sbtOffset,
        traceParams.raySBTOffset + traceParams.raySBTStride * (this.geometries.length - 1) + this.sbtOffset];
}

window.onload = function() {
    optixStructSizeInput = document.getElementById('structParamSize');
    instanceGeometryCountUI = document.getElementById('geometryCount');
    sbtOffsetUI = document.getElementById('instanceSbtOffset');
    instanceMaskUI = document.getElementById('instanceMask');

    dxrUI = [document.getElementById('dxrParamsUI'), document.getElementById('dxrTrace')];
    vulkanUI = [document.getElementById('vulkanParamsUI'), document.getElementById('vulkanTrace')];
    optixUI = [document.getElementById('optixParamsUI'), document.getElementById('optixTrace')];

    // TODO: Something to handle variable size viewports,
    // need to get the w/h of the view
    var svg = d3.select('#sbtWidget');
    sbtWidget = svg.append('g')
        .attr('transform', 'translate(10, 0)');

    sbtWidget.append('g')
        .attr('class', 'sbtWidgetAxis')
        .attr('transform', 'translate(0, 94)');

    var sbtScrollRect = svg.append('rect')
        .attr('y', '94')
        .attr('width', '800')
        .attr('height', '22')
        .attr('fill', 'white')
        .attr('opacity', '0')
        .on('mouseover', function(d) {
            d3.select(this).style('cursor', 'w-resize');
        })
        .on('mouseout', function(d) {
            d3.select(this).style('cursor', 'default');
        });

    sbtScrollRect.call(d3.zoom()
        .on('zoom', function() { 
            sbtWidget.attr('transform', 'translate(' + d3.event.transform.x + ', 0)');
        }))
        .on('wheel.zoom', null);

    shaderRecordWidget = svg.append('g');
    shaderRecordZoomRect = svg.append('rect')
        .attr('y', '328')
        .attr('width', '800')
        .attr('height', '22')
        .attr('fill', 'white')
        .attr('opacity', '0')
        .on('mouseover', function(d) {
            d3.select(this).style('cursor', 'w-resize');
        })
        .on('mouseout', function(d) {
            d3.select(this).style('cursor', 'default');
        });

    shaderRecordZoom = d3.zoom()
        .on('zoom', function() { 
            shaderRecordWidget.attr('transform', 'translate(' + d3.event.transform.x + ', 0)');
        });
    shaderRecordZoomRect.call(shaderRecordZoom).on('wheel.zoom', null);

    instanceWidget = d3.select('#instanceWidget');
    var instanceScrollRect = instanceWidget.append('rect')
        .attr('width', 800)
        .attr('height', 400)
        .attr('fill', 'white');
    instanceContainer = instanceWidget.append('g');

    instanceScrollRect.call(d3.zoom().on('zoom', function() {
            instanceContainer.attr('transform', d3.event.transform);
        }))
        .on('wheel.zoom', null)
        .on('dblclick.zoom', null);

    shaderTable = new ShaderTable();
    instances = [new Instance()];
    selectAPI()
}

var selectAPI = function() {
    var apiName = document.getElementById('selectAPI').value
    currentAPI = API[apiName];

    if (apiName == 'DXR') {
        for (var i = 0; i < 2; ++i) {
            dxrUI[i].setAttribute('style', 'display:block');
            vulkanUI[i].setAttribute('style', 'display:none');
            optixUI[i].setAttribute('style', 'display:none');
        }
    } else if (apiName == 'Vulkan') {
        for (var i = 0; i < 2; ++i) {
            dxrUI[i].setAttribute('style', 'display:none');
            vulkanUI[i].setAttribute('style', 'display:block');
            optixUI[i].setAttribute('style', 'display:none');
        }
    } else {
        for (var i = 0; i < 2; ++i) {
            dxrUI[i].setAttribute('style', 'display:none');
            vulkanUI[i].setAttribute('style', 'display:none');
            optixUI[i].setAttribute('style', 'display:block');
        }
    }

    shaderTable.clearParams();
    updateViews();
}

var updateViews = function() {
    var sbtSize = shaderTable.size();

    var axisLen = Math.ceil(sbtSize / 32.0);
    sbtWidgetScale = d3.scaleLinear([0, 32 * axisLen], [0, 78 * axisLen]);

    var tickValues = [];
    for (var i = 0; i < axisLen + 1; ++i) {
        tickValues.push(32 * i);
    }

    var byteAxis = d3.axisBottom(sbtWidgetScale).tickValues(tickValues);
    sbtWidget.select('.sbtWidgetAxis').call(byteAxis);
    shaderTable.render();
    selectedShaderRecord.render();

    updateInstanceView();

    var alertDisplay = document.getElementById('missOutOfBounds');
    alertDisplay.setAttribute('style', 'display:none')
    if (traceParams.missShaderIndex >= shaderTable.missShaders.length) {
        alertDisplay.innerHTML = 'Miss accesses out of bounds miss shader ' +
            traceParams.missShaderIndex + ' @ ' + (traceParams.missShaderIndex * shaderTable.missStride) + 'b'
        alertDisplay.setAttribute('style', 'display:block')
    }

    alertDisplay = document.getElementById('hgOutOfBounds');
    var hgRange = instances[selectedInstance].hitGroupRange();
    alertDisplay.setAttribute('style', 'display:none')
    if (hgRange[1] >= shaderTable.hitGroups.length) {
        alertDisplay.innerHTML = 'Instance\'s geometry accesses out of bounds hit groups. ' +
            'Instance uses hit groups ' + hgRange[0] + ' to ' + hgRange[1] +
            ', but only ' + shaderTable.hitGroups.length + ' exist.';
        alertDisplay.setAttribute('style', 'display:block')
    }
}

var updateInstanceView = function() {
    for (var i = 0; i < instances.length; ++i) {
        if (!instances[i].userSBTOffset) {
            instances[i].sbtOffset = baseSBTOffset(i);
        }
    }
    instanceGeometryCountUI.value = instances[selectedInstance].numGeometries();
    sbtOffsetUI.value = instances[selectedInstance].sbtOffset;
    instanceMaskUI.value = instances[selectedInstance].mask.toString(16);

    var highlight = instanceContainer.selectAll('.highlight')
        .data([selectedInstance]);
    highlight.enter()
        .append('rect')
        .attr('class', 'highlight')
        .merge(highlight)
        .attr('x', 4)
        .attr('y', function() { return 4 + selectedInstance * 116; })
        .attr('width', function() { return 116 + instances[selectedInstance].numGeometries() * 75 + 8; })
        .attr('height', 108)
        .attr('fill', 'yellow');

    highlight.exit().remove();

    var blasSelection = instanceContainer
        .selectAll('.blas')
        .data(instances);

    var allBlas = blasSelection.enter()
        .append(function() { return makeBLASIcon(); })
        .attr('transform', function(d, i) {
            return 'translate(8, ' + (i * 116 + 8) + ')';
        })
        .merge(blasSelection)
        .on('click', function(d, i) {
            selectedInstance = i;
            updateViews();
        })
        .on('dblclick', function(d, i) {
            if (instances.length == 1) {
                return;
            }
            instances.splice(i, 1);

            if (selectedInstance > 0) {
                if (selectedInstance >= instances.length) {
                    selectedInstance = instances.length - 1;
                }
            }

            updateViews();
        })
        .on('mouseover', function(d) {
            d3.select(this).style('cursor', 'pointer');
        })
        .on('mouseout', function(d) {
            d3.select(this).style('cursor', 'default');
        });

    var triangleSelection = allBlas.selectAll('.triangle')
        .data(function(d) { return d.geometries; });

    triangleSelection.enter()
        .append(function() { return makeTriangle(); })
        .merge(triangleSelection)
        .attr('fill', function(d, i) {
            var hg = d.instance.hitgroupForGeometry(i);
            if (hg < shaderTable.hitGroups.length) {
                return 'white';
            }
            return 'red';
        })
        .attr('transform', function(d, i) {
            return 'translate(' + (116 + i * 75) + ', 14)';
        })
        .on('click', function(d, i) {
            var alertDisplay = document.getElementById('hgOutOfBounds');
            var hg = d.instance.hitgroupForGeometry(i);
            if (hg < shaderTable.hitGroups.length) {
                selectedShaderRecord = shaderTable.hitGroups[hg];
                alertDisplay.setAttribute('style', 'display:none')
                updateViews();
            } else {
                alertDisplay.innerHTML = 'Geometry accesses out of bounds hit group ' +
                    hg + ' @ ' + (hg * shaderTable.hgStride) + 'b';
                alertDisplay.setAttribute('style', 'display:block')
            }
        });

    triangleSelection.exit().remove();
    blasSelection.exit().remove();

    var inactiveInstances = [];
    for (var i = 0; i < instances.length; ++i) {
        if (!(instances[i].mask & traceParams.rayInstanceMask)) {
            inactiveInstances.push(i);
        }
    }

    var inactiveHighlight = instanceContainer.selectAll('.instanceMaskedOut')
        .data(inactiveInstances);
    inactiveHighlight.enter()
        .append('rect')
        .attr('class', 'instanceMaskedOut')
        .merge(inactiveHighlight)
        .attr('x', 4)
        .attr('y', function(d) { return 4 + d * 116; })
        .attr('width', function(d) { return 116 + instances[d].numGeometries() * 75 + 8; })
        .attr('height', 108)
        .attr('fill', 'gray')
        .attr('opacity', 0.5);
    inactiveHighlight.exit().remove();
}

var addShaderRecord = function(defaultName) {
    var nameInput = document.getElementById('shaderRecordName');
    if (nameInput.value == '') {
        nameInput.value = defaultName;
    }

    selectedShaderRecord = new ShaderRecord(nameInput.value);
    if (defaultName == 'hitgroup') {
        shaderTable.hitGroups.push(selectedShaderRecord);
    } else {
        shaderTable.missShaders.push(selectedShaderRecord);
    }

    updateViews();
    nameInput.value = '';
}

var addConstantParam = function() {
    selectedShaderRecord.addParam(new ShaderParam(ParamType.FOUR_BYTE_CONSTANT));

    updateViews();
}

var addGPUHandleParam = function() {
    selectedShaderRecord.addParam(new ShaderParam(ParamType.GPU_HANDLE));

    updateViews();
}

var addStructParam = function() {
    if (optixStructSizeInput.value == '' || optixStructSizeInput.value == 0) {
        selectedShaderRecord.params = [];
    } else {
        selectedShaderRecord.addParam(new ShaderParam(ParamType.STRUCT, parseInt(optixStructSizeInput.value)));
    }

    updateViews();
}

var updateInstance = function() {
    instances[selectedInstance].setNumGeometries(parseInt(instanceGeometryCountUI.value));
    var userSBTOffset = parseInt(sbtOffsetUI.value);
    if (userSBTOffset != instances[selectedInstance].sbtOffset) {
        instances[selectedInstance].sbtOffset = userSBTOffset;
        instances[selectedInstance].userSBTOffset = true;
    }

    var instMaskInput = document.getElementById('instanceMask');
    var val = 0;
    if (instMaskInput.value != undefined && instMaskInput.value != '') {
        val = parseInt(instMaskInput.value, 16);
        val = Math.min(255, Math.max(0, val));
    }
    instances[selectedInstance].mask = val;
    document.getElementById('instanceMask').value = val.toString(16);

    updateViews();
}

var setInstanceSBTOffset = function() {
    instances[selectedInstance].userSBTOffset = false;
    instances[selectedInstance].sbtOffset = baseSBTOffset(selectedInstance);
    updateViews();
}

var addInstance = function() {
    instances.push(new Instance());
    updateViews();
}

var updateTraceCall = function() {
    traceParams.raySBTOffset = parseInt(document.getElementById('raySBTOffset').value);
    traceParams.raySBTStride = parseInt(document.getElementById('raySBTStride').value);
    traceParams.missShaderIndex = parseInt(document.getElementById('missShaderIndex').value);

    var instMaskInput = document.getElementById('rayInstanceMask');
    var val = 0;
    if (instMaskInput.value != undefined && instMaskInput.value != '') {
        val = parseInt(instMaskInput.value, 16);
        val = Math.min(255, Math.max(0, val));
    }
    traceParams.rayInstanceMask = val;

    document.getElementById('rayInstanceMask').value = traceParams.rayInstanceMask.toString(16);

    d3.selectAll('#raySBTOffsetVal').html(traceParams.raySBTOffset);
    d3.selectAll('#raySBTStrideVal').html(traceParams.raySBTStride);
    d3.selectAll('#missShaderIndexVal').html(traceParams.missShaderIndex);
    d3.selectAll('#instanceMaskVal').html('0x' + traceParams.rayInstanceMask.toString(16));

    updateViews();
}

var showMissShader = function() {
    if (traceParams.missShaderIndex < shaderTable.missShaders.length) {
        selectedShaderRecord = shaderTable.missShaders[traceParams.missShaderIndex];
    }
    updateViews();
}

