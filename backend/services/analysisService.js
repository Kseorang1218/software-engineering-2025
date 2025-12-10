const FFT = require('fft.js');
const CONFIG = require('../config/constants');

// FFT 변환 로직
function performFFT(rawData) {
    const f = new FFT(CONFIG.FFT_SIZE);
    const input = new Array(CONFIG.FFT_SIZE);
    const out = f.createComplexArray();
    for (let i = 0; i < CONFIG.FFT_SIZE; i++) {
        if (i < rawData.length) {
            const multiplier = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (rawData.length - 1)));
            input[i] = rawData[i] * multiplier;
        } else { input[i] = 0; }
    }
    f.realTransform(out, input); f.completeSpectrum(out);
    const spectrum = [];
    for (let i = 0; i < CONFIG.FFT_SIZE / 2; i++) {
        const magnitude = Math.sqrt(out[i * 2] ** 2 + out[i * 2 + 1] ** 2);
        spectrum.push({ x: parseFloat((i * (CONFIG.SAMPLE_RATE / CONFIG.FFT_SIZE)).toFixed(1)), y: parseFloat(magnitude.toFixed(4)) });
    }
    return spectrum;
}

// 상태 진단 로직
function diagnoseHealth(stats) {
    let status = 'NORMAL';
    let details = [];
    
    // RMS 체크
    if (stats.rms >= CONFIG.THRESHOLDS.RMS.CRITICAL) { status = 'CRITICAL'; details.push('High RMS'); }
    else if (stats.rms >= CONFIG.THRESHOLDS.RMS.WARNING) { status = status === 'CRITICAL' ? 'CRITICAL' : 'WARNING'; details.push('Elevated RMS'); }
    
    // Kurtosis 체크
    if (stats.kurtosis >= CONFIG.THRESHOLDS.KURTOSIS.CRITICAL) { status = 'CRITICAL'; details.push('Critical Kurtosis'); }
    else if (stats.kurtosis >= CONFIG.THRESHOLDS.KURTOSIS.WARNING) { status = status === 'CRITICAL' ? 'CRITICAL' : 'WARNING'; details.push('High Kurtosis'); }
    
    if (details.length === 0) details.push('Normal Operation');
    return { status, details: details.join(', ') };
}

module.exports = { performFFT, diagnoseHealth };