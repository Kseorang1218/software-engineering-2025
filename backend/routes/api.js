const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const db = require('../config/db');
const CONFIG = require('../config/constants');
const analysisService = require('../services/analysisService');
const emailService = require('../services/emailService');

// 1. 이메일 설정 API
router.post('/config/email', (req, res) => {
    const { email } = req.body;
    emailService.setTargetEmail(email);
    console.log(`📧 알림 받을 이메일 변경됨: ${email}`);
    res.json({ message: "Email updated", email });
});

router.get('/config/email', (req, res) => {
    res.json({ email: emailService.getTargetEmail() });
});

// 2. 임계치 설정 API
router.post('/config/thresholds', (req, res) => {
    const { rms_warning, rms_critical, kurt_warning, kurt_critical } = req.body;
    if (rms_warning) CONFIG.THRESHOLDS.RMS.WARNING = parseFloat(rms_warning);
    if (rms_critical) CONFIG.THRESHOLDS.RMS.CRITICAL = parseFloat(rms_critical);
    if (kurt_warning) CONFIG.THRESHOLDS.KURTOSIS.WARNING = parseFloat(kurt_warning);
    if (kurt_critical) CONFIG.THRESHOLDS.KURTOSIS.CRITICAL = parseFloat(kurt_critical);
    console.log('⚙️ 임계치 설정 변경됨:', CONFIG.THRESHOLDS);
    res.json({ message: "Thresholds updated", currentConfig: CONFIG.THRESHOLDS });
});

router.get('/config/thresholds', (req, res) => { res.json(CONFIG.THRESHOLDS); });

// 3. 데이터 수신 및 처리 API (메인 기능)
router.post('/vibration_data', (req, res) => {
    const data = req.body;
    const io = req.app.get('io'); // server.js에서 등록한 socket.io 인스턴스 가져오기

    try {
        // [서비스 호출 1] 데이터 분석
        const fftResult = analysisService.performFFT(data.raw_data_1khz);
        const healthCheck = analysisService.diagnoseHealth(data.statistics);

        // [서비스 호출 2] 이메일/알림 로직 처리
        emailService.processAlertLogic(data, healthCheck);

        // [DB 및 파일 저장]
        const safeTimestamp = data.timestamp.replace(/[:.]/g, '-');
        const fileName = `${data.sensor_id}_${safeTimestamp}.json`;
        const filePath = path.join(CONFIG.PATHS.RAW_DATA, fileName);

        fs.writeFile(filePath, JSON.stringify(data.raw_data_1khz), () => {});

        const sql = `INSERT INTO sensor_measurements 
            (timestamp, sensor_id, channel, rms, kurtosis, health_status, raw_data_filename) 
            VALUES (?, ?, ?, ?, ?, ?, ?)`;
        
        db.run(sql, [data.timestamp, data.sensor_id, data.channel, data.statistics.rms, data.statistics.kurtosis, healthCheck.status, fileName], (err) => {
            if(!err) console.log(`💾 Data Saved (Status: ${healthCheck.status})`);
        });

        // [웹 클라이언트로 브로드캐스트]
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

// 4. 이력 조회 및 다운로드 (간략화)
router.get('/history', (req, res) => {
    const { start, end } = req.query;
    const sql = `SELECT * FROM sensor_measurements WHERE timestamp >= ? AND timestamp <= ? ORDER BY timestamp DESC`;
    db.all(sql, [start, end], (err, rows) => { err ? res.status(500).json({error: "DB Error"}) : res.json(rows); });
});

router.get('/download/period', async (req, res) => { // ⚠️ app -> router로 변경
    const { start, end } = req.query;
    
    if (!start || !end) return res.status(400).send("시작/종료일 필요");
    
    const sql = `SELECT * FROM sensor_measurements WHERE timestamp >= ? AND timestamp <= ? ORDER BY timestamp ASC`; 
    
    db.all(sql, [start, end], async (err, rows) => {
        if (err || rows.length === 0) return res.status(404).send("No data");
        
        let csvContent = "Timestamp,Sensor_ID,Status,RMS,Kurtosis,Raw_Value\n";
        
        try {
            for (const row of rows) {
                // ⚠️ 중요: 변수명을 위 설정에 맞춰 CONFIG.PATHS.RAW_DATA로 수정했습니다.
                const filePath = path.join(CONFIG.PATHS.RAW_DATA, row.raw_data_filename);
                
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
        } catch (e) { 
            console.error(e);
            res.status(500).send("Error"); 
        }
    });
});

module.exports = router; // ‼️ 이 줄이 반드시 파일의 맨 마지막에 있어야 합니다.