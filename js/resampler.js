/*global console, Float32Array, DataView, FileReader, OfflineAudioContext, ArrayBuffer, Blob*/

// APIs and audio arrays.
var fileReader          = null,
    audioArrayBuffer    = null,
    audioInfoDataView   = null,
    audioDataView       = null,
    audioInputLeft      = null,
    audioInputRight     = null,
    audioOutputLeft     = null,
    audioOutputRight    = null,
    audioOutputBuffer   = null,
// Important global variables.
    inputNumChannels    = 0,
    inputSampleRate     = 0,
    inputBitDepth       = 0,
    inputLength         = 0,
    outputSampleRate    = 48000,
// DOM elements.
    fileInput           = null,
    download            = null;

function getAudio(dataView) {
    audioInputLeft = new Float32Array(inputLength);
    console.log(audioInputLeft.length);
    if (inputNumChannels === 2) {
        audioInputRight = new Float32Array(inputLength);
    }
    var i,
        j = 0;
    if (inputNumChannels === 1) {
        for (i = 0; i < inputLength * inputNumChannels * 2; i += 2) {
            audioInputLeft[j] = dataView.getInt16(44 + i, true) / 0x7FFF;
            j += 1;
        }
    } else if (inputNumChannels === 2) {
        for (i = 0; i < inputLength * inputNumChannels * 2; i += 2) {
            audioInputLeft[j] = dataView.getInt16(44 + i, true) / 0x7FFF;
            i += 2;
            audioInputRight[j] = dataView.getInt16(44 + i, true) / 0x7FFF;
            j += 1;
        }
    }
}

function resample(inL, inR) {
    function linearInterpolate(x1, y1, x2, y2, targetX) {
        var targetY;
        targetY = ((targetX - x1) * (y2 - y1) / (x2 - x1)) + y1;
        return targetY;
    }
    audioOutputLeft = new Float32Array(inputLength * (outputSampleRate / inputSampleRate));
    audioOutputRight = new Float32Array(inputLength * (outputSampleRate / inputSampleRate));
    var i = 0,
        j = 0,
        targetX = 0,
        count = inputSampleRate / outputSampleRate;
    while (i < inputLength) {
        audioOutputLeft[j] = linearInterpolate(i, inL[i], i + 1, inL[i + 1], targetX);
        audioOutputRight[j] = linearInterpolate(i, inR[i], i + 1, inR[i + 1], targetX);
        j += 1;
        targetX += count;
        if (targetX >= i + 1) {
            i += 1;
        }
    }
}

function stereoInterleave(inL, inR) {
    'use strict';
    var length = inL.length + inR.length,
	    result = new Float32Array(length),
	    i = 0,
	    j = 0;
	while (i < length) {
		result[i += 1] = inL[j];
		result[i += 1] = inR[j];
        console.log('Applying stereo interleave...');
		j += 1;
	}
	return result;
}

function render(audioBuffer) {
    function stringToUint(dataView, offset, string) {
        var length = string.length,
            i = 0;
        for (i = 0; i < length; i += 1) {
            dataView.setUint8(offset + i, string.charCodeAt(i));
        }
    }
    var arrayBuffer,
        length = audioBuffer.length,
        dataView,
        i,
        j,
        audioBlob,
        url,
        link,
        click;
    arrayBuffer = new ArrayBuffer(44 + length * 4);
    console.log(arrayBuffer.byteLength);
    dataView = new DataView(arrayBuffer);
    i = 0;
    j = 44;
    console.log('Output infortmation:');
    stringToUint(dataView, 0, 'RIFF');                              // Chunk ID
    dataView.setUint32(4, 44 + length * 2, true);                   // Chunk Size
    stringToUint(dataView, 8, 'WAVE');                              // Format
    // fmt sub-chunk
    stringToUint(dataView, 12, 'fmt ');                             // Sub-chunk 1 ID
    dataView.setUint32(16, 16, true);                               // Sub-chunk 1 Size
    dataView.setUint16(20, 1, true);                                // Audio format (1 = PCM)
    dataView.setUint16(22, 2, true);                                // Number of channels
    console.log('Channel count: ' + dataView.getUint16(22, true));
    dataView.setUint32(24, outputSampleRate, true);                 // Sample rate
    console.log('Sample rate: ' + dataView.getUint32(24, true));
    dataView.setUint32(28, outputSampleRate * 2 * (16 / 8), true);  // Byte rate
    dataView.setUint16(32, 4, true);                                // Block align
    dataView.setUint16(34, 16, true);                               // Bits per sample (bit depth)
    console.log('Bit depth: ' + dataView.getUint16(34, true));
    // data sub-chunk
    stringToUint(dataView, 36, 'data');                             // Sub-chunk 2 ID
    dataView.setUint32(40, length * 2, true);                       // Sub-chunk 2 Size
    console.log('Audio length (bytes): ' + dataView.getUint32(40, true) / inputNumChannels / (inputBitDepth / 8));
    console.log('Audio length (seconds): ' + dataView.getUint32(40, true) / inputNumChannels / (inputBitDepth / 8) / outputSampleRate);
    for (i = 0; i < length / 2; i += 1) {                   // Sub-chunk 2 data
        dataView.setInt16(j, audioBuffer[i] * 0x7FFF, true);
        j += 2;
    }
    audioBlob = new Blob([dataView], {type : 'audio/wav'});
    url = (window.URL || window.webkitURL).createObjectURL(audioBlob);
    link = window.document.createElement('a');
    link.href = url;
    link.download = 'output.wav';
    click = document.createEvent("Event");
    click.initEvent("click", true, true);
    link.dispatchEvent(click);
}

window.onload = function () {
    fileInput = document.getElementById('fileInput');
    fileInput.onchange = function () {
        fileReader = new FileReader();
        fileReader.onload = function () {
            audioInfoDataView = new DataView(this.result);
            // Read .wav RIFF header and store some relevant information.
            inputNumChannels = audioInfoDataView.getUint16(22, true);
            console.log('Channel count: ' + inputNumChannels);
            inputSampleRate = audioInfoDataView.getUint32(24, true);
            console.log('Sample rate: ' + inputSampleRate);
            inputBitDepth = audioInfoDataView.getUint16(34, true);
            console.log('Bit depth: ' + inputBitDepth);
            inputLength = audioInfoDataView.getUint32(40, true) / inputNumChannels / (inputBitDepth / 8);
            console.log('Audio length (samples): ' + inputLength);
            console.log('Audio length (seconds): ' + inputLength / inputSampleRate);

            // Get audio data from the DataView.
            getAudio(audioInfoDataView);

            // Resample audio data at new sample rate.
            console.log('Conversation ratio = ' + inputSampleRate / outputSampleRate);
            resample(audioInputLeft, audioInputRight);

            // If input is stereo create a stereo interleaved array.
            if (inputNumChannels === 2) {
                audioOutputBuffer = stereoInterleave(audioOutputLeft, audioOutputRight);
            } else {
                audioOutputBuffer = audioOutputLeft;
            }
            render(audioOutputBuffer);
        };
        fileReader.readAsArrayBuffer(this.files[0]);
    };
};