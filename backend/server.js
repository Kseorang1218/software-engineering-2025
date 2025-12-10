const express = require('express');
const http = require('http'); // ‼️ 추가: HTTP 서버
const { Server } = require("socket.io"); // ‼️ 추가: 소켓 서버
const fs = require('fs');
const path = require('path');
const FFT = require('fft.js');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const server = http.createServer(app); // ‼️ Express와 HTTP 결합
const io = new Server(server); // ‼️ 소켓 서버 생성

const PORT = 5000;

// ======== 저장소 설정 ========
const DB_PATH = path.join(__dirname, 'vibration_db.sqlite');
const RAW_DATA_DIR = path.join(__dirname, 'raw_files');

if (!fs.existsSync(RAW_DATA_DIR)) fs.mkdirSync(RAW_DATA_DIR);

const db = new sqlite3.Database(DB_PATH, (err) => {
    if (!err) {
        db.run(`CREATE TABLE IF NOT EXISTS sensor_measurements (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT,
            sensor_id TEXT,
            channel INTEGER,
            rms REAL,
            kurtosis REAL,
            health_status TEXT,
            raw_data_filename TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
    }
});

// ======== 설정 (Config) ========
const CONFIG = {
    SAMPLE_RATE: 1000,
    FFT_SIZE: 1024,
    THRESHOLDS: {
        RMS: { WARNING: 0.5, CRITICAL: 1.0 },
        KURTOSIS: { WARNING: 4.0, CRITICAL: 6.0 }
    }
};

app.use(express.json({ limit: '5mb' }));

// ‼️ [추가] 정적 파일(HTML) 제공 설정
// 'public' 폴더 안에 있는 index.html을 브라우저에 보여줍니다.
app.use(express.static(path.join(__dirname, 'public')));

// ======== 로직 함수 (FFT & 진단) ========
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
        spectrum.push({ x: parseFloat(frequency.toFixed(1)), y: parseFloat(magnitude.toFixed(4)) });
    }
    return spectrum;
}

function diagnoseHealth(stats) {
    let status = 'NORMAL';
    let details = [];
    if (stats.rms >= CONFIG.THRESHOLDS.RMS.CRITICAL) { status = 'CRITICAL'; details.push('High RMS'); }
    else if (stats.rms >= CONFIG.THRESHOLDS.RMS.WARNING) { status = status === 'CRITICAL' ? 'CRITICAL' : 'WARNING'; details.push('Elevated RMS'); }
    
    if (stats.kurtosis >= CONFIG.THRESHOLDS.KURTOSIS.CRITICAL) { status = 'CRITICAL'; details.push('Critical Kurtosis'); }
    else if (stats.kurtosis >= CONFIG.THRESHOLDS.KURTOSIS.WARNING) { status = status === 'CRITICAL' ? 'CRITICAL' : 'WARNING'; details.push('High Kurtosis'); }
    
    if (details.length === 0) details.push('Normal Operation');
    return { status, details: details.join(', ') };
}

// ======== 소켓 연결 이벤트 ========
io.on('connection', (socket) => {
    console.log('🖥️  웹 대시보드 접속됨 (ID:', socket.id, ')');
});

// ======== API 엔드포인트 ========
app.post('/api/vibration_data', (req, res) => {
    const data = req.body;
    
    try {
        // 1. 분석
        const fftResult = performFFT(data.raw_data_1khz);
        const healthCheck = diagnoseHealth(data.statistics);

        // 2. 저장 (DB + File)
        const safeTimestamp = data.timestamp.replace(/:/g, '-').replace(/\./g, '-');
        const fileName = `${data.sensor_id}_${safeTimestamp}.json`;
        const filePath = path.join(RAW_DATA_DIR, fileName);

        fs.writeFile(filePath, JSON.stringify(data.raw_data_1khz), () => {}); // 파일 저장

        const sql = `INSERT INTO sensor_measurements 
            (timestamp, sensor_id, channel, rms, kurtosis, health_status, raw_data_filename) 
            VALUES (?, ?, ?, ?, ?, ?, ?)`;
        
        db.run(sql, [data.timestamp, data.sensor_id, data.channel, data.statistics.rms, data.statistics.kurtosis, healthCheck.status, fileName], (err) => {
            if(!err) console.log(`💾 Data Saved (Status: ${healthCheck.status})`);
        });

        // 3. ‼️ [핵심] 웹 대시보드로 데이터 실시간 송출 (Broadcast)
        io.emit('sensor-update', {
            sensor_id: data.sensor_id,
            timestamp: data.timestamp,
            rms: data.statistics.rms,
            kurtosis: data.statistics.kurtosis,
            skewness: data.statistics.skewness,
            health_status: healthCheck.status,
            health_details: healthCheck.details,
            fft_data: fftResult,        // FFT 차트 데이터
            raw_data: data.raw_data_1khz // 시간 파형 차트 데이터
        });

        res.json({ message: "Processed, Saved & Broadcasted" });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server Error" });
    }
});
// [추가] 임계치 설정 변경 API
app.post('/api/config/thresholds', (req, res) => {
    const { rms_warning, rms_critical, kurt_warning, kurt_critical } = req.body;

    // 서버의 설정값 업데이트
    if (rms_warning) CONFIG.THRESHOLDS.RMS.WARNING = parseFloat(rms_warning);
    if (rms_critical) CONFIG.THRESHOLDS.RMS.CRITICAL = parseFloat(rms_critical);
    if (kurt_warning) CONFIG.THRESHOLDS.KURTOSIS.WARNING = parseFloat(kurt_warning);
    if (kurt_critical) CONFIG.THRESHOLDS.KURTOSIS.CRITICAL = parseFloat(kurt_critical);

    console.log('⚙️ 임계치 설정 변경됨:', CONFIG.THRESHOLDS);
    res.json({ message: "Thresholds updated", currentConfig: CONFIG.THRESHOLDS });
});

// [추가] 현재 설정값 조회 API (팝업 띄울 때 사용)
app.get('/api/config/thresholds', (req, res) => {
    res.json(CONFIG.THRESHOLDS);
});

// [추가] 과거 데이터 조회 API (UC-002)
app.get('/api/history', (req, res) => {
    // 쿼리 파라미터로 시작일과 종료일을 받음 (예: ?start=2023-10-01&end=2023-10-02)
    const { start, end } = req.query;

    if (!start || !end) {
        return res.status(400).json({ error: "검색할 날짜 범위(start, end)가 필요합니다." });
    }

    // SQLite에서 문자열 비교를 통해 날짜 범위 검색
    // timestamp 컬럼이 'YYYY-MM-DDTHH:mm:ss...' 형식의 문자열로 저장되어 있다고 가정
    const sql = `
        SELECT id, timestamp, sensor_id, rms, kurtosis, health_status, raw_data_filename 
        FROM sensor_measurements 
        WHERE timestamp >= ? AND timestamp <= ? 
        ORDER BY timestamp DESC
    `;

    db.all(sql, [start, end], (err, rows) => {
        if (err) {
            console.error(err);
            res.status(500).json({ error: "데이터베이스 조회 중 오류가 발생했습니다." });
        } else {
            res.json(rows); // 조회된 데이터를 JSON 배열로 응답
        }
    });
});

// [추가] CSV 다운로드 처리 API (UC-003)
app.get('/api/download/csv/:id', (req, res) => {
    const id = req.params.id;

    // 1. DB에서 해당 ID의 메타데이터(통계값, 파일명 등) 조회
    db.get(`SELECT * FROM sensor_measurements WHERE id = ?`, [id], (err, row) => {
        if (err || !row) {
            return res.status(404).send("데이터를 찾을 수 없습니다.");
        }

        // 2. 서버 로컬 폴더에서 원시 데이터 파일(JSON) 읽기
        const filePath = path.join(RAW_DATA_DIR, row.raw_data_filename);
        
        fs.readFile(filePath, 'utf8', (fileErr, fileContent) => {
            if (fileErr) {
                console.error("파일 읽기 실패:", fileErr);
                return res.status(500).send("원본 데이터 파일이 손실되었습니다.");
            }

            try {
                // 3. 파일 내용(JSON 배열) 파싱
                const rawData = JSON.parse(fileContent); 

                // 4. CSV 내용 생성 (헤더 + 데이터)
                // 요구사항: 원시 데이터뿐만 아니라 RMS, Kurtosis도 포함
                let csvContent = "Time_Index,Raw_Value,RMS,Kurtosis,Timestamp\n";

                rawData.forEach((value, index) => {
                    // 각 행마다 통계값을 반복해서 넣어줍니다 (분석 시 편리함)
                    csvContent += `${index},${value},${row.rms},${row.kurtosis},${row.timestamp}\n`;
                });

                // 5. 브라우저가 파일을 다운로드하도록 응답 헤더 설정
                // 파일명 예시: sensor1_2025-11-26-14-30-00.csv
                const downloadFileName = `${row.sensor_id}_${row.timestamp.replace(/[:.]/g, '-')}.csv`;
                
                res.setHeader('Content-Type', 'text/csv');
                res.setHeader('Content-Disposition', `attachment; filename="${downloadFileName}"`);
                res.send(csvContent);

            } catch (parseErr) {
                console.error("JSON 파싱 에러:", parseErr);
                res.status(500).send("데이터 변환 중 오류가 발생했습니다.");
            }
        });
    });
});

// [추가] 기간별 데이터 일괄 다운로드 API (Bulk Export)
// [수정] 기간별 데이터 일괄 다운로드 API (Status 포함 버전)
app.get('/api/download/period', async (req, res) => {
    const { start, end } = req.query;

    if (!start || !end) {
        return res.status(400).send("시작일과 종료일이 필요합니다.");
    }

    // 1. 해당 기간의 DB 데이터 조회 (SELECT * 이므로 health_status도 이미 가져옵니다)
    const sql = `SELECT * FROM sensor_measurements 
                 WHERE timestamp >= ? AND timestamp <= ? 
                 ORDER BY timestamp ASC`; 

    db.all(sql, [start, end], async (err, rows) => {
        if (err) {
            return res.status(500).send("DB 조회 오류");
        }
        if (rows.length === 0) {
            return res.status(404).send("해당 기간에 데이터가 없습니다.");
        }

        // 2. CSV 헤더 생성 (‼️ Status 컬럼 추가됨)
        let csvContent = "Timestamp,Sensor_ID,Status,RMS,Kurtosis,Raw_Value\n";

        try {
            for (const row of rows) {
                const filePath = path.join(RAW_DATA_DIR, row.raw_data_filename);
                
                if (fs.existsSync(filePath)) {
                    const fileContent = await fs.promises.readFile(filePath, 'utf8');
                    const rawData = JSON.parse(fileContent);

                    // 3. 데이터 병합
                    rawData.forEach((val) => {
                        // ‼️ 한 줄에 health_status 추가
                        csvContent += `${row.timestamp},${row.sensor_id},${row.health_status},${row.rms},${row.kurtosis},${val}\n`;
                    });
                }
            }

            // 4. 파일 다운로드 제공
            const fileName = `Export_${start}_to_${end}.csv`.replace(/[: ]/g, '-');
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
            res.send(csvContent);

        } catch (error) {
            console.error(error);
            res.status(500).send("데이터 병합 중 오류가 발생했습니다.");
        }
    });
});

// ‼️ server.listen 사용 (app.listen 아님)
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server Running: http://localhost:${PORT}`);
});