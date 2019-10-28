var API = {
    "DXR": {
        SHADER_IDENTIFIER_SIZE: 32,
        SHADER_TABLE_BYTE_ALIGNMENT: 64,
    },
    "Vulkan": {
        SHADER_IDENTIFIER_SIZE: 16,
        SHADER_TABLE_BYTE_ALIGNMENT: 64,
    },
    "OptiX": {
        SHADER_IDENTIFIER_SIZE: 32,
        SHADER_TABLE_BYTE_ALIGNMENT: 16,
    },
};

var ParamType = {
    STRUCT: 1,
    FOUR_BYTE_CONSTANT: 2,
    GPU_HANDLE: 3,
};

var currentAPI = API["OptiX"];

var alignTo = function(val, align) {
    return Math.floor((val + align - 1) / align) * align;
}

var ShaderParam = function(paramType, paramSize) {
    this.type = paramType;
    if (this.type == ParamType.STRUCT) {// && currentAPI == API["OptiX"]) {
        this.size = paramSize;
    } else if (this.type == ParamType.FOUR_BYTE_CONSTANT) {
        //&& (currentAPI == API["DXR"] || currentAPI == API["Vulkan"])) {
        this.size = 4;
    } else if (this.type == ParamType.GPU_HANDLE) {// && currentAPI == API["DXR"]) {
        this.size = 8;
    } else {
        alert("Unrecognized ParamType or invalid param type for current API");
    }
}

var ShaderRecord = function(name) {
    // TODO: Need to do a validation pass for DXR shaders to pad 4byte constants
    this.params = [];
    this.name = name;
}

ShaderRecord.prototype.addParam = function(param) {
    this.params.push(param);
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

ShaderRecord.prototype.render = function(sbtWidget, baseOffset) {
    sbtWidget.select('.shaderRecordDetail').remove();
    var widget = sbtWidget.append('g')
        .attr('class', 'shaderRecordDetail')
        .attr('transform', 'translate(32, 140)');

    var selection = widget.selectAll('.shaderRecordTitle').data([this]);
    selection.enter()
        .append('text')
        .merge(selection)
        .text(function (d) { return "Shader Record: " + d.name + " @ " + baseOffset; });
    selection.exit().remove();

    var scale = d3.scaleLinear([0, this.size()], [0, this.size() * 6]);

    selection = widget.selectAll('.shaderRecordHandle').data([this]);
    selection.enter()
        .append('rect')
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
        .attr('y', 8)
        .attr('height', 180)
        .attr('stroke-width', 2)
        .attr('stroke', 'gray')
        .merge(selection)
        .attr('fill', function (d) {
            if (d.type == ParamType.STRUCT) {
                return 'yellow';
            }
            if (d.type == ParamType.FOUR_BYTE_CONSTANT) {
                return 'lightblue'
            }
            if (d.type == ParamType.GPU_HANDLE) {
                return 'lightgreen';
            }
            return 'gray';
        })
        .attr('width', function (d) {
            return scale(d.size);
        })
        .attr('x', function (d) {
            var pos = offset;
            offset += d.size;
            return scale(pos);
        });
    selection.exit().remove();

    offset = currentAPI.SHADER_IDENTIFIER_SIZE;
    selection = widget.selectAll('.shaderRecordParamText').data(this.params);
    selection.enter()
        .append('text')
        .attr('transform', 'rotate(-90)')
        .attr('dominant-baseline', 'middle')
        .attr('y', function (d) {
            var pos = offset + d.size / 2.0;
            offset += d.size;
            return scale(pos);
        })
        .attr('x', -180)
        .merge(selection)
        .text(function (d) {
            if (d.type == ParamType.STRUCT) {
                return 'Struct (' + d.size + 'b)';
            }
            if (d.type == ParamType.FOUR_BYTE_CONSTANT) {
                return '4-byte Constant'
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
    var testHG = new ShaderRecord("hitgroup");
    testHG.addParam(new ShaderParam(ParamType.STRUCT, 24));

    var testMiss = new ShaderRecord("miss");

    this.raygen = new ShaderRecord("raygen");
    this.raygen.addParam(new ShaderParam(ParamType.STRUCT, 4));
    this.raygen.addParam(new ShaderParam(ParamType.FOUR_BYTE_CONSTANT));
    this.raygen.addParam(new ShaderParam(ParamType.GPU_HANDLE));
    this.hitGroups = [testHG, testHG];
    this.missShaders = [testMiss];
}

ShaderTable.prototype.render = function(widget, xScale) {
    var self = this;
    var recordOffsets = [0];

    // Draw the raygen program
    var raygenSelection = widget.selectAll('.raygen').data([this.raygen]);
    raygenSelection.enter()
        .append('rect')
        .attr('x', xScale(0))
        .attr('y', 30)
        .attr('height', 64)
        .attr('stroke-width', 2)
        .attr('stroke', 'black')
        .attr('fill', 'white')
        .merge(raygenSelection)
        .on('mouseover', function (d) {
            d3.select(this).style('cursor', 'pointer');
        })
        .on('mouseout', function (d) {
            d3.select(this).style('cursor', 'default');
        })
        .attr('width', xScale(this.raygen.size()) - xScale(0))
        .on('click', function (d) {
            d.render(widget, 0);
        });

    raygenSelection.exit().remove();

    var offset = alignTo(this.raygen.size(), currentAPI.SHADER_TABLE_BYTE_ALIGNMENT);
    var hgSelection = widget.selectAll('.hitgroup').data(this.hitGroups);
    hgSelection.enter()
        .append('rect')
        .attr('y', 30)
        .attr('height', 64)
        .attr('stroke-width', 2)
        .attr('stroke', 'black')
        .attr('fill', 'blue')
        .on('mouseover', function (d) {
            d3.select(this).style('cursor', 'pointer');
        })
        .on('mouseout', function (d) {
            d3.select(this).style('cursor', 'default');
        })
        .merge(hgSelection)
        .on('click', function (d, i) {
            d.render(widget, recordOffsets[1 + i]);
        })
        .attr('x', function (d) {
            var pos = offset;
            recordOffsets.push(pos);
            offset = alignTo(offset + d.size(), currentAPI.SHADER_TABLE_BYTE_ALIGNMENT);
            return xScale(pos);
        })
        .attr('width', function (d) {
            return xScale(d.size()) - xScale(0);
        });

    hgSelection.exit().remove();

    var missSelection = widget.selectAll('.miss').data(this.missShaders);
    missSelection.enter()
        .append('rect')
        .attr('y', 30)
        .attr('height', 64)
        .attr('stroke-width', 2)
        .attr('stroke', 'black')
        .attr('fill', 'red')
        .on('mouseover', function (d) {
            d3.select(this).style('cursor', 'pointer');
        })
        .on('mouseout', function (d) {
            d3.select(this).style('cursor', 'default');
        })
        .merge(missSelection)
        .on('click', function (d, i) {
            d.render(widget, recordOffsets[1 + self.hitGroups.length + i]);
        })
        .attr('x', function (d) {
            var pos = offset;
            recordOffsets.push(pos);
            offset = alignTo(offset + d.size(), currentAPI.SHADER_TABLE_BYTE_ALIGNMENT);
            return xScale(pos);
        })
        .attr('width', function (d) {
            return xScale(d.size()) - xScale(0);
        });

    missSelection.exit().remove();
}

window.onload = function() {
    // TODO: Something to handle variable size viewports,
    // need to get the w/h of the view
    var sbtWidget = d3.select('#sbtWidget');
    sbtWidget.select('.currentAPI').text('API: OptiX')
        .attr('dominant-baseline', 'hanging');

    var scale = d3.scaleLinear([0, 320], [10, 790]);

    var tickValues = [];
    for (var i = 0; i < 320; ++i) {
        tickValues.push(32 * i);
    }
    var byteAxis = d3.axisBottom(scale).tickValues(tickValues);
    sbtWidget.append('g').attr('transform', 'translate(0, 94)').call(byteAxis);

    var shaderTable = new ShaderTable();
    shaderTable.render(sbtWidget, scale);

    shaderTable.raygen.render(sbtWidget, 0);
}

