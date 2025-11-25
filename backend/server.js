const express = require('express');
const fs = require('fs');
const path = require('path');
const FFT = require('fft.js');
const sqlite3 = require('sqlite3').verbose(); // ‼️ SQLite 모듈 로드

const app = express();
const PORT = 5000;

// ======== 1. 저장소 설정 (Hybrid Architecture) ========

// (1) 메타데이터 저장용 DB 파일
const DB_PATH = path.join(__dirname, 'vibration_db.sqlite');

// (2) 원시 데이터(Raw Data) 저장용 폴더
const RAW_DATA_DIR = path.join(__dirname, 'raw_files');

// 서버 시작 시, raw_files 폴더가 없으면 자동으로 생성
if (!fs.existsSync(RAW_DATA_DIR)) {
    fs.mkdirSync(RAW_DATA_DIR);
    console.log(`📂 원시 데이터 저장 폴더 생성됨: ${RAW_DATA_DIR}`);
}

// (3) SQLite 데이터베이스 초기화 및 테이블 생성
const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error('DB 연결 실패:', err.message);
    } else {
        console.log('📦 SQLite 데이터베이스 연결 성공');
        
        // 테이블 스키마 정의: raw_data 자체를 저장하지 않고 '파일 경로(path)'만 저장함
        db.run(`CREATE TABLE IF NOT EXISTS sensor_measurements (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT,
            sensor_id TEXT,
            channel INTEGER,
            rms REAL,
            kurtosis REAL,
            health_status TEXT,
            raw_data_filename TEXT,  -- ‼️ 핵심: 배열 대신 파일명을 저장
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
    }
});

// ======== 2. 설정 (Configuration) ========
const CONFIG = {
    SAMPLE_RATE: 1000,
    FFT_SIZE: 1024,
    THRESHOLDS: {
        RMS: { WARNING: 0.5, CRITICAL: 1.0 },
        KURTOSIS: { WARNING: 4.0, CRITICAL: 6.0 }
    }
};

app.use(express.json({ limit: '5mb' }));

// ======== 3. 핵심 알고리즘 (FFT & 진단) - 기존과 동일 ========
function performFFT(rawData) {
    const f = new FFT(CONFIG.FFT_SIZE);
    const input = new Array(CONFIG.FFT_SIZE);
    const out = f.createComplexArray();
    for (let i = 0; i < CONFIG.FFT_SIZE; i++) {
        if (i < rawData.length) {
            const multiplier = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (rawData.length - 1)));
            input[i] = rawData[i] * multiplier;
        } else {
            input[i] = 0;
        }
    }
    f.realTransform(out, input);
    f.completeSpectrum(out);
    const spectrum = [];
    for (let i = 0; i < CONFIG.FFT_SIZE / 2; i++) {
        const real = out[i * 2];
        const imag = out[i * 2 + 1];
        const magnitude = Math.sqrt(real * real + imag * imag);
        const frequency = i * (CONFIG.SAMPLE_RATE / CONFIG.FFT_SIZE);
        spectrum.push({ f: parseFloat(frequency.toFixed(1)), m: parseFloat(magnitude.toFixed(4)) });
    }
    return spectrum;
}

function diagnoseHealth(stats) {
    let status = 'NORMAL';
    let details = [];
    if (stats.rms >= CONFIG.THRESHOLDS.RMS.CRITICAL) {
        status = 'CRITICAL';
        details.push('High RMS');
    } else if (stats.rms >= CONFIG.THRESHOLDS.RMS.WARNING) {
        status = status === 'CRITICAL' ? 'CRITICAL' : 'WARNING';
        details.push('Elevated RMS');
    }
    if (stats.kurtosis >= CONFIG.THRESHOLDS.KURTOSIS.CRITICAL) {
        status = 'CRITICAL';
        details.push('Critical Kurtosis');
    } else if (stats.kurtosis >= CONFIG.THRESHOLDS.KURTOSIS.WARNING) {
        status = status === 'CRITICAL' ? 'CRITICAL' : 'WARNING';
        details.push('High Kurtosis');
    }
    return { status, details: details.join(', ') };
}

// ======== 4. API 엔드포인트 (데이터 수신 및 저장) ========

app.post('/api/vibration_data', (req, res) => {
    const data = req.body;
    
    // 콘솔 로그 간소화
    console.log(`📡 [${data.sensor_id}] 데이터 수신 (Time: ${data.timestamp})`);

    try {
        // --- A. 분석 수행 ---
        const fftResult = performFFT(data.raw_data_1khz);
        const healthCheck = diagnoseHealth(data.statistics);

        // --- B. [하이브리드 저장 전략] ---
        
        // 1. 파일명 생성 (특수문자 제거)
        // 예: S001_2025-11-25T10-30-00.json
        const safeTimestamp = data.timestamp.replace(/:/g, '-').replace(/\./g, '-');
        const fileName = `${data.sensor_id}_${safeTimestamp}.json`;
        const filePath = path.join(RAW_DATA_DIR, fileName);

        // 2. 원시 데이터(배열)를 JSON 파일로 저장
        // (비동기 처리: 파일 쓰기가 완료될 때까지 기다리지 않고 DB 작업 진행 가능하지만,
        //  안정성을 위해 파일 쓰기 시도 후 DB 저장을 진행하는 것이 좋음. 여기서는 병렬 처리)
        
        fs.writeFile(filePath, JSON.stringify(data.raw_data_1khz), (err) => {
            if (err) console.error("❌ 파일 저장 실패:", err);
            // 파일 저장이 성공하면 'raw_files' 폴더에 파일이 생김
        });

        // 3. DB에는 '통계값'과 '파일명'만 INSERT (아주 가벼움)
        const sql = `INSERT INTO sensor_measurements 
            (timestamp, sensor_id, channel, rms, kurtosis, health_status, raw_data_filename) 
            VALUES (?, ?, ?, ?, ?, ?, ?)`;
        
        const params = [
            data.timestamp,
            data.sensor_id,
            data.channel,
            data.statistics.rms,
            data.statistics.kurtosis,
            healthCheck.status,
            fileName // ‼️ 파일명만 저장
        ];

        db.run(sql, params, function(err) {
            if (err) {
                console.error("❌ DB 저장 실패:", err.message);
            } else {
                console.log(`💾 저장 완료 [DB ID: ${this.lastID}] [File: ${fileName}]`);
            }
        });

        // --- C. 응답 전송 ---
        if (healthCheck.status !== 'NORMAL') {
            console.warn(`⚠️  ALARM: ${healthCheck.status} - ${healthCheck.details}`);
        }

        res.status(200).json({
            message: "Processed and Saved (Hybrid)",
            sensor: data.sensor_id,
            timestamp: data.timestamp,
            health_status: healthCheck.status,
            health_details: healthCheck.details,
            fft_data: fftResult
        });

    } catch (err) {
        console.error('Processing Error:', err);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// 서버 종료 시 DB 연결 해제
process.on('SIGINT', () => {
    db.close(() => {
        console.log('DB 연결 해제됨');
        process.exit(0);
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`==========================================`);
    console.log(`🚀 Hybrid Server Running on Port ${PORT}`);
    console.log(`📄 DB File:   ${DB_PATH}`);
    console.log(`📂 Raw Files: ${RAW_DATA_DIR}`);
    console.log(`==========================================`);
});