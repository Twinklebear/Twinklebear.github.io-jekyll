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

var optixStructSizeInput = null;
var sbtWidget = null;
var sbtWidgetScale = d3.scaleLinear([0, 320], [10, 790]);

var alignTo = function(val, align) {
    return Math.floor((val + align - 1) / align) * align;
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

ShaderRecord.prototype.render = function(parentWidget) {
    var self = this;
    optixStructSizeInput.value = '';

    parentWidget.select('.shaderRecordDetail').remove();
    var widget = parentWidget.append('g')
        .attr('class', 'shaderRecordDetail')
        .attr('transform', 'translate(32, 140)');

    var selection = widget.selectAll('.shaderRecordTitle').data([this]);
    selection.enter()
        .append('text')
        .attr('class', 'shaderRecordTitle')
        .merge(selection)
        .text(function(d) { return 'Shader Record: ' + d.name + ' @ ' + self.baseOffset; });
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

    selectedShaderRecord = this.raygen;
}

ShaderTable.prototype.render = function(widget, xScale) {
    var self = this;

    // Draw the raygen program
    var raygenSelection = widget.selectAll('.raygen').data([this.raygen]);
    raygenSelection.enter()
        .append('rect')
        .attr('class', 'raygen')
        .attr('x', xScale(0))
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
            d.render(widget);
        })
        .attr('width', xScale(this.raygen.size()) - xScale(0));

    raygenSelection.exit().remove();

    // Determine the starting offset stride for the hit groups
    var offset = alignTo(this.raygen.size(), currentAPI.SHADER_TABLE_BYTE_ALIGNMENT);
    var hgStride = 0;
    for (var i = 0; i < this.hitGroups.length; ++i) {
        hgStride = Math.max(hgStride, alignTo(this.hitGroups[i].size(), currentAPI.SHADER_TABLE_BYTE_ALIGNMENT)); 
    }

    var hgSelection = widget.selectAll('.hitgroup').data(this.hitGroups);
    hgSelection.enter()
        .append('rect')
        .attr('class', 'hitgroup')
        .attr('y', 30)
        .attr('height', 64)
        .attr('stroke-width', 2)
        .attr('stroke', 'black')
        .attr('fill', 'blue')
        .on('mouseover', function(d) {
            d3.select(this).style('cursor', 'pointer');
        })
        .on('mouseout', function(d) {
            d3.select(this).style('cursor', 'default');
        })
        .merge(hgSelection)
        .on('click', function(d, i) {
            selectedShaderRecord = d;
            d.render(widget);
        })
        .attr('x', function(d, i) {
            var pos = hgStride * i + offset;
            d.setBaseOffset(pos);
            return xScale(pos);
        })
        .attr('width', function(d) {
            return xScale(d.size()) - xScale(0);
        });

    hgSelection.exit().remove();

    // Compute offset and stride for the miss shaders
    offset += hgStride * this.hitGroups.length;
    var missStride = 0;
    for (var i = 0; i < this.missShaders.length; ++i) {
        missStride = Math.max(missStride, alignTo(this.missShaders[i].size(), currentAPI.SHADER_TABLE_BYTE_ALIGNMENT)); 
    }

    var missSelection = widget.selectAll('.miss').data(this.missShaders);
    missSelection.enter()
        .append('rect')
        .attr('class', 'miss')
        .attr('y', 30)
        .attr('height', 64)
        .attr('stroke-width', 2)
        .attr('stroke', 'black')
        .attr('fill', 'red')
        .on('mouseover', function(d) {
            d3.select(this).style('cursor', 'pointer');
        })
        .on('mouseout', function(d) {
            d3.select(this).style('cursor', 'default');
        })
        .merge(missSelection)
        .on('click', function(d, i) {
            selectedShaderRecord = d;
            d.render(widget);
        })
        .attr('x', function(d, i) {
            var pos = missStride * i + offset;
            d.setBaseOffset(pos);
            return xScale(pos);
        })
        .attr('width', function(d) {
            return xScale(d.size()) - xScale(0);
        });

    missSelection.exit().remove();
}

window.onload = function() {
    optixStructSizeInput = document.getElementById('structParamSize');

    // TODO: Something to handle variable size viewports,
    // need to get the w/h of the view
    sbtWidget = d3.select('#sbtWidget');

    var tickValues = [];
    for (var i = 0; i < 320; ++i) {
        tickValues.push(32 * i);
    }
    var byteAxis = d3.axisBottom(sbtWidgetScale).tickValues(tickValues);
    sbtWidget.append('g').attr('transform', 'translate(0, 94)').call(byteAxis);

    selectAPI()
}

var selectAPI = function() {
    var apiName = document.getElementById('selectAPI').value
    currentAPI = API[apiName];

    if (apiName == 'DXR') {
        document.getElementById('dxrParamsUI').setAttribute('style', 'display:block');
        document.getElementById('vulkanParamsUI').setAttribute('style', 'display:none');
        document.getElementById('optixParamsUI').setAttribute('style', 'display:none');
    } else if (apiName == 'Vulkan') {
        document.getElementById('dxrParamsUI').setAttribute('style', 'display:none');
        document.getElementById('vulkanParamsUI').setAttribute('style', 'display:block');
        document.getElementById('optixParamsUI').setAttribute('style', 'display:none');
    } else {
        document.getElementById('dxrParamsUI').setAttribute('style', 'display:none');
        document.getElementById('vulkanParamsUI').setAttribute('style', 'display:none');
        document.getElementById('optixParamsUI').setAttribute('style', 'display:block');
    }

    shaderTable = new ShaderTable();
    shaderTable.render(sbtWidget, sbtWidgetScale);
    selectedShaderRecord.render(sbtWidget);
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
    shaderTable.render(sbtWidget, sbtWidgetScale);
    selectedShaderRecord.render(sbtWidget);
    nameInput.value = '';
}

var addConstantParam = function() {
    selectedShaderRecord.addParam(new ShaderParam(ParamType.FOUR_BYTE_CONSTANT));

    shaderTable.render(sbtWidget, sbtWidgetScale);
    selectedShaderRecord.render(sbtWidget);
}

var addGPUHandleParam = function() {
    selectedShaderRecord.addParam(new ShaderParam(ParamType.GPU_HANDLE));

    shaderTable.render(sbtWidget, sbtWidgetScale);
    selectedShaderRecord.render(sbtWidget);
}

var addStructParam = function() {
    if (optixStructSizeInput.value == '') {
        alert('Struct size cannot be empty');
        return;
    }
    selectedShaderRecord.addParam(new ShaderParam(ParamType.STRUCT, parseInt(optixStructSizeInput.value)));

    shaderTable.render(sbtWidget, sbtWidgetScale);
    selectedShaderRecord.render(sbtWidget);
}

