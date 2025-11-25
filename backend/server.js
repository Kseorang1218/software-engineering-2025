const express = require('express');
const fs = require('fs');
const path = require('path');
const FFT = require('fft.js'); // ‼️ npm install fft.js 필요

const app = express();
const PORT = 5000;
const LOG_FILE_PATH = path.join(__dirname, 'vibration_data.log');

// ======== 1. 설정 및 임계값 관리 (Configuration) ========
// 유지보수를 위해 매직 넘버를 상수로 분리
const CONFIG = {
    SAMPLE_RATE: 1000,   // Hz (클라이언트에서 다운샘플링된 속도)
    FFT_SIZE: 1024,      // 2의 제곱수 (고속 연산을 위함, 1000개 샘플 -> 1024로 패딩)
    THRESHOLDS: {
        RMS: {
            WARNING: 0.5, // 예: 0.5g 이상이면 주의
            CRITICAL: 1.0 // 예: 1.0g 이상이면 위험
        },
        KURTOSIS: {
            WARNING: 4.0, // 베어링 결함 시 보통 3.0을 초과하여 상승함
            CRITICAL: 6.0
        }
    }
};

app.use(express.json({ limit: '5mb' }));

// ======== 2. 핵심 알고리즘 함수 (Logic Layer) ========

/**
 * 시간 영역 데이터를 주파수 영역(Spectrum)으로 변환
 * @param {Array} rawData - 1k 샘플 데이터
 * @returns {Array} - { frequency, magnitude } 객체의 배열
 */
function performFFT(rawData) {
    const f = new FFT(CONFIG.FFT_SIZE);
    const input = new Array(CONFIG.FFT_SIZE);
    const out = f.createComplexArray();

    // 데이터 전처리: Hanning Window 적용 및 Zero Padding
    // (데이터가 1000개이고 FFT_SIZE가 1024이므로 나머지는 0으로 채워짐)
    for (let i = 0; i < CONFIG.FFT_SIZE; i++) {
        if (i < rawData.length) {
            // Hanning Window 적용 (스펙트럼 누설 방지)
            const multiplier = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (rawData.length - 1)));
            input[i] = rawData[i] * multiplier;
        } else {
            input[i] = 0; // Padding
        }
    }

    // FFT 수행
    f.realTransform(out, input);
    f.completeSpectrum(out);

    // Magnitude(크기) 계산 및 결과 포맷팅
    const spectrum = [];
    // Nyquist Frequency까지만 계산 (절반)
    for (let i = 0; i < CONFIG.FFT_SIZE / 2; i++) {
        const real = out[i * 2];
        const imag = out[i * 2 + 1];
        const magnitude = Math.sqrt(real * real + imag * imag);
        
        // 주파수 축 계산: k * (Fs / N)
        const frequency = i * (CONFIG.SAMPLE_RATE / CONFIG.FFT_SIZE);

        spectrum.push({
            f: parseFloat(frequency.toFixed(1)),
            m: parseFloat(magnitude.toFixed(4))
        });
    }
    return spectrum;
}

/**
 * 통계값을 기반으로 이상 여부 진단
 * @param {Object} stats - 클라이언트에서 받은 통계값
 * @returns {Object} - 상태 코드 및 메시지
 */
function diagnoseHealth(stats) {
    let status = 'NORMAL';
    let details = [];

    // RMS 진단 (전반적인 에너지/불균형)
    if (stats.rms >= CONFIG.THRESHOLDS.RMS.CRITICAL) {
        status = 'CRITICAL';
        details.push('High RMS (Severe Vibration)');
    } else if (stats.rms >= CONFIG.THRESHOLDS.RMS.WARNING) {
        status = status === 'CRITICAL' ? 'CRITICAL' : 'WARNING';
        details.push('Elevated RMS');
    }

    // Kurtosis 진단 (베어링/기어 충격)
    if (stats.kurtosis >= CONFIG.THRESHOLDS.KURTOSIS.CRITICAL) {
        status = 'CRITICAL';
        details.push('Critical Kurtosis (Bearing Damage)');
    } else if (stats.kurtosis >= CONFIG.THRESHOLDS.KURTOSIS.WARNING) {
        status = status === 'CRITICAL' ? 'CRITICAL' : 'WARNING';
        details.push('High Kurtosis (Impact detected)');
    }

    return { status, details: details.join(', ') };
}

// ======== 3. API 엔드포인트 ========

app.post('/api/vibration_data', (req, res) => {
    const data = req.body;
    const startTime = Date.now(); // 처리 시간 측정용

    console.log(`[${data.timestamp}] SENSOR ${data.sensor_id} 데이터 수신`);

    try {
        // --- A. FFT 분석 수행 ---
        // 클라이언트가 1000개 데이터를 보냈다고 가정
        const fftResult = performFFT(data.raw_data_1khz);

        // --- B. 이상 진단 수행 ---
        const healthCheck = diagnoseHealth(data.statistics);

        // --- C. 로그 생성 및 저장 ---
        // 파일에는 원본 데이터는 너무 크니 제외하고 요약 정보만 남기는 것도 고려 가능
        // 여기서는 전체를 저장한다고 가정
        const logData = {
            ...data,
            server_analysis: {
                health: healthCheck,
                processed_at: new Date().toISOString()
            }
            // FFT 결과는 파일 크기가 너무 커질 수 있으므로 로그 파일엔 제외하거나 필요시 포함
        };

        const logEntry = JSON.stringify(logData) + '\n';
        
        fs.appendFile(LOG_FILE_PATH, logEntry, (err) => {
            if (err) console.error('파일 저장 오류:', err);
        });

        // --- D. 결과 출력 (서버 콘솔) ---
        if (healthCheck.status !== 'NORMAL') {
            console.warn(` ⚠️  ALARM: [${healthCheck.status}] ${healthCheck.details}`);
        } else {
            console.log(` ✅  Status: NORMAL (RMS: ${data.statistics.rms.toFixed(3)})`);
        }

        // --- E. 응답 전송 ---
        // 클라이언트에게 분석 결과와 FFT 데이터를 돌려주어 화면에 그리게 함
        res.status(200).json({
            message: "Analyzed successfully",
            sensor: data.sensor_id,
            timestamp: data.timestamp,
            health_status: healthCheck.status, // 화면 색상 변경용 (Green/Yellow/Red)
            health_details: healthCheck.details,
            fft_data: fftResult // 차트 그리기용 데이터
        });

    } catch (err) {
        console.error('Processing Error:', err);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Running on http://0.0.0.0:${PORT}`);
    console.log(`Data logging to: ${LOG_FILE_PATH}`);
});