const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const fs = require('fs');
const path = require('path');
const FFT = require('fft.js');
const sqlite3 = require('sqlite3').verbose();
const nodemailer = require('nodemailer'); // ‼️ [추가] 이메일 라이브러리

require('dotenv').config({ path: path.join(__dirname, '.env') });

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 5000;

// ======== 저장소 설정 ========
const DB_PATH = path.join(__dirname, 'vibration_db.sqlite');
const RAW_DATA_DIR = path.join(__dirname, 'raw_files');

if (!fs.existsSync(RAW_DATA_DIR)) fs.mkdirSync(RAW_DATA_DIR);

const db = new sqlite3.Database(DB_PATH, (err) => {
    if (!err) {
        // 기본 측정 데이터 테이블
        db.run(`CREATE TABLE IF NOT EXISTS sensor_measurements (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT, sensor_id TEXT, channel INTEGER, rms REAL, kurtosis REAL, health_status TEXT, raw_data_filename TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
        // ‼️ [추가] 알림 이력 테이블 (선택 사항)
        db.run(`CREATE TABLE IF NOT EXISTS alert_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT, sensor_id TEXT, severity TEXT, message TEXT
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

// ‼️ [추가] 이메일 관련 변수
let targetEmail = ""; // 사용자가 웹에서 입력할 '받는 사람' 주소
const sensorState = {}; // 센서별 연속 이상 횟수 카운트용

// ‼️ [필수 설정] 보내는 사람(서버) 이메일 설정 (Gmail 예시)
// 
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER, // ✏️ 보내는 사람 이메일 (직접 수정 필요)
        pass: process.env.EMAIL_PASS      // ✏️ 구글 앱 비밀번호 (직접 수정 필요)
    }
});

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ======== 로직 함수 ========
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

// 1. ‼️ [추가] 이메일 주소 설정 API (유저 아이콘 팝업에서 호출)
app.post('/api/config/email', (req, res) => {
    const { email } = req.body;
    targetEmail = email; // 사용자가 입력한 이메일을 변수에 저장
    console.log(`📧 알림 받을 이메일 변경됨: ${targetEmail}`);
    res.json({ message: "Email updated", email: targetEmail });
});

app.get('/api/config/email', (req, res) => {
    res.json({ email: targetEmail });
});

// 2. 임계치 설정 API (기존 유지)
app.post('/api/config/thresholds', (req, res) => {
    const { rms_warning, rms_critical, kurt_warning, kurt_critical } = req.body;
    if (rms_warning) CONFIG.THRESHOLDS.RMS.WARNING = parseFloat(rms_warning);
    if (rms_critical) CONFIG.THRESHOLDS.RMS.CRITICAL = parseFloat(rms_critical);
    if (kurt_warning) CONFIG.THRESHOLDS.KURTOSIS.WARNING = parseFloat(kurt_warning);
    if (kurt_critical) CONFIG.THRESHOLDS.KURTOSIS.CRITICAL = parseFloat(kurt_critical);
    console.log('⚙️ 임계치 설정 변경됨:', CONFIG.THRESHOLDS);
    res.json({ message: "Thresholds updated", currentConfig: CONFIG.THRESHOLDS });
});
app.get('/api/config/thresholds', (req, res) => { res.json(CONFIG.THRESHOLDS); });


// 3. 데이터 수신 및 처리 API (핵심 로직 수정됨)
app.post('/api/vibration_data', (req, res) => {
    const data = req.body;
    
    try {
        // 1. 분석
        const fftResult = performFFT(data.raw_data_1khz);
        const healthCheck = diagnoseHealth(data.statistics);

        // ================================================
        // ‼️ [핵심] 10회 연속 이상 시 이메일 발송 로직
        // ================================================
        
        // 센서별 상태 변수 초기화
        if (!sensorState[data.sensor_id]) {
            sensorState[data.sensor_id] = { count: 0, mailSent: false };
        }
        const state = sensorState[data.sensor_id];

        // 상태 확인
        if (healthCheck.status !== 'NORMAL') {
            state.count++; // 이상하면 카운트 증가
            
            // 조건: 10회 이상 지속 AND 아직 메일 안 보냄 AND 받을 이메일 설정됨
            if (state.count >= 10 && !state.mailSent && targetEmail) {
                console.log(`📧 [메일 발송] ${data.sensor_id} 위험 10초 지속! -> ${targetEmail}`);
                
                // 메일 내용 구성
                const mailOptions = {
                    from: 'Vibration Monitor System', // 보내는 이름
                    to: targetEmail,                  // 받는 사람 (사용자 설정값)
                    subject: `[경고] ${data.sensor_id} 이상 감지 (10초 지속)`,
                    html: `
                        <h3>⚠️ 장비 이상 알림</h3>
                        <p>센서 <b>${data.sensor_id}</b> 상태가 <b>${healthCheck.status}</b>로 10초간 지속되었습니다.</p>
                        <ul>
                            <li>발생 시간: ${data.timestamp}</li>
                            <li>현재 RMS: ${data.statistics.rms.toFixed(4)} (기준: ${CONFIG.THRESHOLDS.RMS.CRITICAL})</li>
                            <li>진단 내용: ${healthCheck.details}</li>
                        </ul>
                        <p>즉시 확인 바랍니다.</p>
                        <hr>
                        <p><a href="http://localhost:${PORT}">모니터링 시스템 바로가기</a></p>
                    `
                };

                // 메일 전송 실행
                transporter.sendMail(mailOptions, (error, info) => {
                    if (error) console.log('메일 전송 실패:', error);
                    else console.log('메일 전송 성공:', info.response);
                });

                state.mailSent = true; // 중복 발송 방지 (한 번만 보냄)
            }
        } else {
            // 정상이면 카운터 리셋
            state.count = 0;
            state.mailSent = false;
        }
        // ================================================


        // 2. 저장 (DB + File)
        const safeTimestamp = data.timestamp.replace(/[:.]/g, '-');
        const fileName = `${data.sensor_id}_${safeTimestamp}.json`;
        const filePath = path.join(RAW_DATA_DIR, fileName);

        fs.writeFile(filePath, JSON.stringify(data.raw_data_1khz), () => {});

        const sql = `INSERT INTO sensor_measurements 
            (timestamp, sensor_id, channel, rms, kurtosis, health_status, raw_data_filename) 
            VALUES (?, ?, ?, ?, ?, ?, ?)`;
        
        db.run(sql, [data.timestamp, data.sensor_id, data.channel, data.statistics.rms, data.statistics.kurtosis, healthCheck.status, fileName], (err) => {
            if(!err) console.log(`💾 Data Saved (Status: ${healthCheck.status})`);
        });

        // 3. 웹 송출
        io.emit('sensor-update', {
            sensor_id: data.sensor_id,
            timestamp: data.timestamp,
            rms: data.statistics.rms,
            kurtosis: data.statistics.kurtosis,
            skewness: data.statistics.skewness,
            health_status: healthCheck.status,
            health_details: healthCheck.details,
            fft_data: fftResult,
            raw_data: data.raw_data_1khz
        });

        res.json({ message: "Processed, Saved & Broadcasted" });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server Error" });
    }
});

// 과거 데이터 조회 및 다운로드 API들 (기존 유지)
app.get('/api/history', (req, res) => {
    const { start, end } = req.query;
    if (!start || !end) return res.status(400).json({ error: "날짜 범위 필요" });
    const sql = `SELECT id, timestamp, sensor_id, rms, kurtosis, health_status, raw_data_filename FROM sensor_measurements WHERE timestamp >= ? AND timestamp <= ? ORDER BY timestamp DESC`;
    db.all(sql, [start, end], (err, rows) => { err ? res.status(500).json({error: "DB Error"}) : res.json(rows); });
});

app.get('/api/download/csv/:id', (req, res) => {
    const id = req.params.id;
    db.get(`SELECT * FROM sensor_measurements WHERE id = ?`, [id], (err, row) => {
        if (err || !row) return res.status(404).send("Data not found");
        const filePath = path.join(RAW_DATA_DIR, row.raw_data_filename);
        fs.readFile(filePath, 'utf8', (fileErr, fileContent) => {
            if (fileErr) return res.status(500).send("File missing");
            const rawData = JSON.parse(fileContent);
            let csvContent = "Time_Index,Raw_Value,RMS,Kurtosis,Timestamp\n";
            rawData.forEach((value, index) => { csvContent += `${index},${value},${row.rms},${row.kurtosis},${row.timestamp}\n`; });
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="${row.sensor_id}_${row.timestamp.replace(/[:.]/g, '-')}.csv"`);
            res.send(csvContent);
        });
    });
});

app.get('/api/download/period', async (req, res) => {
    const { start, end } = req.query;
    if (!start || !end) return res.status(400).send("시작/종료일 필요");
    const sql = `SELECT * FROM sensor_measurements WHERE timestamp >= ? AND timestamp <= ? ORDER BY timestamp ASC`; 
    db.all(sql, [start, end], async (err, rows) => {
        if (err || rows.length === 0) return res.status(404).send("No data");
        let csvContent = "Timestamp,Sensor_ID,Status,RMS,Kurtosis,Raw_Value\n";
        try {
            for (const row of rows) {
                const filePath = path.join(RAW_DATA_DIR, row.raw_data_filename);
                if (fs.existsSync(filePath)) {
                    const fileContent = await fs.promises.readFile(filePath, 'utf8');
                    JSON.parse(fileContent).forEach(val => {
                        csvContent += `${row.timestamp},${row.sensor_id},${row.health_status},${row.rms},${row.kurtosis},${val}\n`;
                    });
                }
            }
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="Export_${start}_to_${end}.csv"`);
            res.send(csvContent);
        } catch (e) { res.status(500).send("Error"); }
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server Running: http://localhost:${PORT}`);
});