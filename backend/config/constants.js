const path = require('path');

const CONFIG = {
    PORT: 5000,
    SAMPLE_RATE: 1000,
    FFT_SIZE: 1024,
    THRESHOLDS: {
        RMS: { WARNING: 0.5, CRITICAL: 1.0 },
        KURTOSIS: { WARNING: 4.0, CRITICAL: 6.0 }
    },
    // 파일 저장 경로 (프로젝트 루트 기준으로 설정)
    PATHS: {
        DB: path.join(__dirname, '../vibration_db.sqlite'),
        RAW_DATA: path.join(__dirname, '../raw_files')
    }
};

module.exports = CONFIG;