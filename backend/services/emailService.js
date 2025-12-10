const nodemailer = require('nodemailer');
const CONFIG = require('../config/constants');
require('dotenv').config(); // 환경변수 로드

// 상태 관리용 변수
let targetEmail = ""; 
const sensorState = {}; 

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

function setTargetEmail(email) {
    targetEmail = email;
}

function getTargetEmail() {
    return targetEmail;
}

// 경고 조건 확인 및 메일 발송 (핵심 비즈니스 로직)
function processAlertLogic(data, healthCheck) {
    // 초기화
    if (!sensorState[data.sensor_id]) {
        sensorState[data.sensor_id] = { count: 0, mailSent: false };
    }
    const state = sensorState[data.sensor_id];

    if (healthCheck.status !== 'NORMAL') {
        state.count++;
        
        // [조건] 10회 이상 지속 AND 메일 미발송 AND 수신자 설정됨
        if (state.count >= 10 && !state.mailSent && targetEmail) {
            console.log(`📧 [메일 발송] ${data.sensor_id} 위험 10초 지속! -> ${targetEmail}`);
            
            const mailOptions = {
                from: 'Vibration Monitor System',
                to: targetEmail,
                subject: `[경고] ${data.sensor_id} 이상 감지 (10초 지속)`,
                html: `
                    <h3>⚠️ 장비 이상 알림</h3>
                    <p>센서 <b>${data.sensor_id}</b> 상태가 <b>${healthCheck.status}</b>로 10초간 지속되었습니다.</p>
                    <ul>
                        <li>시간: ${data.timestamp}</li>
                        <li>RMS: ${data.statistics.rms.toFixed(4)}</li>
                        <li>진단: ${healthCheck.details}</li>
                    </ul>
                `
            };

            transporter.sendMail(mailOptions, (error, info) => {
                if (error) console.log('메일 전송 실패:', error);
                else console.log('메일 전송 성공:', info.response);
            });

            state.mailSent = true; 
        }
    } else {
        // 정상이면 리셋
        state.count = 0;
        state.mailSent = false;
    }
}

module.exports = { setTargetEmail, getTargetEmail, processAlertLogic };