const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
require('dotenv').config(); // 환경변수 로드

// 모듈 불러오기
const CONFIG = require('./config/constants');
const apiRoutes = require('./routes/api');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// 전역에서 socket io를 사용할 수 있게 설정 (API 라우터에서 사용)
app.set('io', io);

// 미들웨어
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// 라우터 등록
app.use('/api', apiRoutes);

// 소켓 연결 이벤트
io.on('connection', (socket) => {
    console.log('🖥️  웹 대시보드 접속됨 (ID:', socket.id, ')');
});

// 서버 시작
server.listen(CONFIG.PORT, '0.0.0.0', () => {
    console.log(`🚀 GEM Server Running: http://localhost:${CONFIG.PORT}`);
    console.log(`📁 Data Dir: ${CONFIG.PATHS.RAW_DATA}`);
});