const express = require('express');
const fs = require('fs'); // ‼️ 1. File System 모듈 추가
const path = require('path'); // ‼️ (선택사항) 경로 관리를 위해 추가

const app = express();
const PORT = 5000;

// ‼️ 2. 저장할 파일 경로 정의
const LOG_FILE_PATH = path.join(__dirname, 'vibration_data.log');

// 미들웨어 설정
app.use(express.json({ limit: '5mb' }));

// ======== API 엔드포인트 정의 ========

app.post('/api/vibration_data', (req, res) => {
    
    const data = req.body;

    // 1. 데이터 수신 확인 (콘솔 로그)
    console.log(`[${data.timestamp}] SENSOR ${data.sensor_id} (CH ${data.channel}) 데이터 수신`);
    console.log(`  > RMS: ${data.statistics.rms.toFixed(4)} ${data.units}`);
    
    // --- ‼️ 3. 파일 저장 로직 추가 ‼️ ---
    try {
        // (1) 데이터를 JSON 문자열로 변환
        // (2) 파일에 한 줄씩(\n) 저장하기 위해 JSON Lines 형식 사용
        const logEntry = JSON.stringify(data) + '\n'; 

        // (3) 비동기(Non-blocking)로 파일에 내용 추가 (Append)
        // 'vibration_data.log' 파일이 없으면 자동 생성됩니다.
        fs.appendFile(LOG_FILE_PATH, logEntry, (err) => {
            if (err) {
                // 파일 저장 실패 시, 서버 콘솔에만 오류 로깅
                console.error('파일 저장 오류:', err);
            }
            // (파일 저장 성공 여부와 관계없이 클라이언트에겐 성공 응답)
        });

    } catch (err) {
        console.error('JSON 변환 오류:', err);
    }
    // ------------------------------------

    // 4. 클라이언트에 성공 응답 전송 (파일 저장과 비동기)
    res.status(200).json({ 
        message: "Data received successfully",
        sensor: data.sensor_id,
        channel: data.channel
    });
});

// ======== 서버 시작 ========
app.listen(PORT, '0.0.0.0', () => {
    console.log(`=================================`);
    console.log(`  진동 모니터링 백엔드 서버`);
    console.log(`  Listening on http://0.0.0.0:${PORT}`);
    console.log(`  (데이터가 ${LOG_FILE_PATH} 에 저장됩니다)`); // ‼️ 4. 로그 메시지 추가
    console.log(`=================================`);
});