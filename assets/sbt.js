var DXR = {
    SHADER_IDENTIFIER_SIZE: 32,
    SHADER_TABLE_BYTE_ALIGNMENT: 64,
};

var Vulkan = {
    // TODO: check these values on my desktop at home
    SHADER_IDENTIFIER_SIZE: 16,
    SHADER_TABLE_BYTE_ALIGNMENT: 32,
};

var OptiX = {
    SHADER_IDENTIFIER_SIZE: 32,
    SHADER_TABLE_BYTE_ALIGNMENT: 16,
};

window.onload = function() {
    // TODO: Something to handle variable size viewports,
    // need to get the w/h of the view
    var sbtWidget = d3.select('#sbtWidget');

    var scale = d3.scaleLinear([0, 320], [0, 800]);

    var tickValues = [];
    for (var i = 0; i < 320; ++i) {
        tickValues.push(32 * i);
    }
    var byteAxis = d3.axisBottom(scale).tickValues(tickValues);
    sbtWidget.append('g').attr('transform', 'translate(0, 64)').call(byteAxis);

    sbtWidget.append('rect')
        .attr('x', 0)
        .attr('y', 0)
        .attr('width', scale(64))
        .attr('height', 64)
        .attr('stroke-width', 2)
        .attr('stroke', 'black')
        .attr('fill', 'none');
}

