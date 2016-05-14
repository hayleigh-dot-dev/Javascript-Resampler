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
    outputSampleRate    = 96000,
// DOM elements.
    fileInput           = null,
    download            = null;

/* The getAudio function reads the binary data in the //
// DataView as signed 16bit integers and copies this  //
// data into a new array. If the uploaded file is     //
// stereo then the loop alternates between writing to //
// the left channel and right channel as stereo .wavs //
// are interleaved. The i increments by two because   //
// 16bit integers are 2 bytes long.                   */
function getAudio(dataView) {
    audioInputLeft = new Float32Array(inputLength);
    if (inputNumChannels === 2) {
        audioInputRight = new Float32Array(inputLength);
    }
    // Variables in javascript have function scope not block scope.
    var i,
        j = 0;
    if (inputNumChannels === 1) {
        for (i = 0; i < inputLength * inputNumChannels * 2; i += 2) {
            // Divide by 0x7FFF (32767) to get values between 0 and 1.
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

/* The program uses linear interpolation to upsample  //
// the audio. Standard downsampling (removing samples)//
// is planned and potentially decimation to follow.   //
// The count vairable is the ratio between the input  //
// sample rate and the output, when convering from    //
// 44.1k to 48k this ratio is 0.91875. Incrementing   //
// this value shows us where to interpolate between   //
// the two input values. If count becomes greater than//
// i + 1, we increment count and interpolate between  //
// the next two values.                               //
// Downsampling is achieved via multirate resampling. //
// If the downsampling factor is not an integer first //
// the input audio is upsampled to a multiple of the  //
// target output sample rate, and then downsampled    //
// from there.                                        */
function upsample(inL, inR, targetSampleRate) {
    // Formula for the linear interpolation can be found here:
    // https://www.easycalculation.com/formulas/linear-interpolation.html
    function linearInterpolate(x1, y1, x2, y2, targetX) {
        var targetY;
        targetY = ((targetX - x1) * (y2 - y1) / (x2 - x1)) + y1;
        return targetY;
    }
    var i = 0,
        j = 0,
        targetX = 0,
        count = inputSampleRate / targetSampleRate;
    audioOutputLeft = new Float32Array(inputLength * (targetSampleRate / inputSampleRate));
    audioOutputRight = new Float32Array(inputLength * (targetSampleRate / inputSampleRate));
    i = 0;
    j = 0;
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
// There appears to be a memory leak or some other ineffeciency with the downsample function.
function downsample(inL, inR, targetSampleRate) {
    function sampleAveraging(dsFactor, audioBuffer, index) {
        var i = 0,
            j = 0,
            result;
        for (i = 0; i < dsFactor; i += 1) {
            j += audioBuffer[index + i];
        }
        result = j / dsFactor;
        return result;
    }
    var i = 0,
        j = 0,
        downsamplingFactor = inputSampleRate / targetSampleRate,
        tempSampleRate;
    // If ds factor is not an integer, find the lowest multiple of the output SR that is greater than this input SR.
    if (downsamplingFactor % 1 !== 0) {
        i = 0;
        while (i < 10) {
            if (targetSampleRate * i > inputSampleRate) {
                tempSampleRate = targetSampleRate * i;
                break;
            } else {
                i += 1;
            }
        }
        upsample(inL, inR, tempSampleRate);
        /* The upsample function writes data to the audioOutput buffers.  //
        // We'll copy this data over to the inL/inR variables and rewrite //
        // the audioOutput buffers again when downsampling.               */
        inL = audioOutputLeft;
        inR = audioOutputRight;
        downsamplingFactor = tempSampleRate / targetSampleRate;
    }
    audioOutputLeft = new Float32Array(inputLength / downsamplingFactor);
    audioOutputRight = new Float32Array(inputLength / downsamplingFactor);
    for (i = 0; i < inputLength; i += downsamplingFactor) {
        audioOutputLeft[j] = downsample(downsamplingFactor, inL, i);
        audioOutputRight[j] = downsample(downsamplingFactor, inR, i);
        j += 1;
    }
}

/* Stereo interleaving simply creates a new audio     //
// buffer and alternates writing data from the left   //
// and right channel.                                 */
function stereoInterleave(inL, inR) {
    'use strict';
    var length = inL.length + inR.length,
	    result = new Float32Array(length),
	    i = 0,
	    j = 0;
	while (i < length) {
		result[i += 1] = inL[j];
		result[i += 1] = inR[j];
		j += 1;
	}
	return result;
}

/* The render function writes the audio data into a   //
// new DataView as well as rewriting the RIFF header  //
// information. stringToUint converts the UTF-8       //
// encoded characters to unsigned 8bit integers. As   //
// with reading from a DataView the process is very   //
// much the same, creating an ArrayBuffer of the right//
// length and then interfacing with this ArrayBuffer  //
// with a DataView.                                   */
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
    dataView = new DataView(arrayBuffer);
    i = 0;
    j = 44;
    console.log('');
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
    for (i = 0; i < length; i += 1) {                   // Sub-chunk 2 data
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
            // If statement to determine upsampling, downsampling or no action.
            if (outputSampleRate > inputSampleRate) {
                upsample(audioInputLeft, audioInputRight, outputSampleRate);
            } else if (outputSampleRate < inputSampleRate) {
                window.alert('Downsampling is not supported at this time.');
                //downsample(audioInputLeft, audioInputRight, outputSampleRate);
            } else {
                audioOutputLeft = audioInputLeft;
                audioOutputRight = audioInputRight;
            }

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