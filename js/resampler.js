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
    outputSampleRate    = 24000,
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
function resample(inL, inR) {
    function linearInterpolate(x1, y1, x2, y2, targetX) {
        var targetY;
        targetY = ((targetX - x1) * (y2 - y1) / (x2 - x1)) + y1;
        return targetY;
    }
    function downsample(dsFactor, audioBuffer, index) {
        var i = 0,
            j = 0,
            result;
        for (i = 0; i < dsFactor; i += 1) {
            j += audioBuffer[i + index];
        }
        result = j / dsFactor;
        return result;
    }
    var i = 0,
        j = 0,
        targetX = 0,
        count = inputSampleRate / outputSampleRate,
        downsampleFactor = inputSampleRate / outputSampleRate,
        tempSampleRate,
        leftTempBuffer,
        rightTempBuffer;
    // Upsample
    if (inputSampleRate / outputSampleRate < 1) {
        console.log('Upsampling...');
        audioOutputLeft = new Float32Array(inputLength * (outputSampleRate / inputSampleRate));
        audioOutputRight = new Float32Array(inputLength * (outputSampleRate / inputSampleRate));
        i = 0;
        while (i < inputLength) {
            audioOutputLeft[j] = linearInterpolate(i, inL[i], i + 1, inL[i + 1], targetX);
            audioOutputRight[j] = linearInterpolate(i, inR[i], i + 1, inR[i + 1], targetX);
            j += 1;
            targetX += count;
            if (targetX >= i + 1) {
                i += 1;
            }
        }
    // Downsample
    } else if (inputSampleRate / outputSampleRate > 1) {
        console.log('Downsampling...');
        // If the downsample factor is not a whole number, upsample first.
        if (downsampleFactor % 1 !== 0) {
            console.log('Downsampling factor is not an integer.');
            console.log('Performing multirate resampling...');
            while (i < 10) {
                if (i * outputSampleRate > inputSampleRate) {
                    tempSampleRate = i;
                    break;
                } else {
                    i += 1;
                }
            }
            leftTempBuffer = new Float32Array(inputLength * ((outputSampleRate * tempSampleRate) / inputSampleRate));
            rightTempBuffer = new Float32Array(inputLength * ((outputSampleRate * tempSampleRate) / inputSampleRate));
            i = 0;
            count = inputSampleRate / (outputSampleRate * tempSampleRate);
            while (i < inputLength) {
                leftTempBuffer[j] = linearInterpolate(i, inL[i], i + 1, inL[i + 1], targetX);
                rightTempBuffer[j] = linearInterpolate(i, inR[i], i + 1, inR[i + 1], targetX);
                j += 1;
                targetX += count;
                if (targetX >= i + 1) {
                    i += 1;
                }
            }
            // Copy data from temporary buffers back to input buffers.
            inL = leftTempBuffer;
            inR = rightTempBuffer;
            // Recalculate downsample factor.
            downsampleFactor = (tempSampleRate * outputSampleRate) / outputSampleRate;
        }
        audioOutputLeft = new Float32Array(inputLength / downsampleFactor);
        audioOutputRight = new Float32Array(inputLength / downsampleFactor);
        while (i < inputLength) {
            audioOutputLeft[j] = downsample(downsampleFactor, inL, i);
            console.log(audioOutputLeft[j]);
            audioOutputRight[j] = downsample(downsampleFactor, inR, i);
            j += 1;
            i += downsampleFactor;
        }
    } else {
        audioOutputLeft = audioInputLeft;
        audioOutputRight = audioInputRight;
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