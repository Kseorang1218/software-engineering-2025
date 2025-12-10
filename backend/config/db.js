const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const CONFIG = require('./constants');

// raw_files 폴더가 없으면 생성
if (!fs.existsSync(CONFIG.PATHS.RAW_DATA)) {
    fs.mkdirSync(CONFIG.PATHS.RAW_DATA);
}

const db = new sqlite3.Database(CONFIG.PATHS.DB, (err) => {
    if (!err) {
        // 테이블 생성
        db.run(`CREATE TABLE IF NOT EXISTS sensor_measurements (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT, sensor_id TEXT, channel INTEGER, rms REAL, kurtosis REAL, health_status TEXT, raw_data_filename TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
        
        db.run(`CREATE TABLE IF NOT EXISTS alert_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT, sensor_id TEXT, severity TEXT, message TEXT
        )`);
        console.log('✅ Database Connected & Tables Ready');
    } else {
        console.error('❌ Database Connection Error:', err);
    }
});

module.exports = db;