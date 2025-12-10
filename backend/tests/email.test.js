// tests/email.test.js
// 1. 가짜 함수(Mock Function)를 먼저 정의합니다.
const mockSendMail = jest.fn((mailOptions, callback) => {
    callback(null, { response: 'ok' });
});

// 2. nodemailer 모듈을 통째로 가짜로 대체합니다. (Mock Factory 패턴)
// 이 코드는 다른 어떤 require보다 먼저 실행됩니다 (Hoisting).
jest.mock('nodemailer', () => ({
    createTransport: jest.fn().mockReturnValue({
        sendMail: mockSendMail
    })
}));

// 3. 그 다음 서비스를 불러옵니다. 이제 transporter가 위의 가짜 객체로 초기화됩니다.
const emailService = require('../services/emailService');

describe('이메일 알림 서비스 테스트', () => {
    
    // 각 테스트 시작 전에 호출 기록을 초기화합니다.
    beforeEach(() => {
        mockSendMail.mockClear(); 
        // 상태 초기화가 필요하다면 emailService 내의 상태를 리셋하는 로직이 필요할 수 있음
        // 현재는 메모리 변수라 테스트 간 간섭이 있을 수 있으므로 주의
    });

    test('10회 연속 이상 발생 시에만 이메일을 발송해야 한다 (상호작용 검증)', () => {
        // 이메일 수신자 설정
        emailService.setTargetEmail('test@example.com');

        const dummyData = { sensor_id: 'S1', timestamp: '2025-01-01', statistics: { rms: 2.0 } };
        const healthCheck = { status: 'CRITICAL', details: 'Test Error' };

        // [Step 1] 1~9회차: 이메일이 발송되면 안 됨
        for (let i = 0; i < 9; i++) {
            emailService.processAlertLogic(dummyData, healthCheck);
        }
        
        // mockSendMail이 호출되지 않았어야 함
        expect(mockSendMail).not.toHaveBeenCalled();

        // [Step 2] 10회차: 이메일이 발송되어야 함
        emailService.processAlertLogic(dummyData, healthCheck);
        
        // mockSendMail이 정확히 1번 호출되었는지 확인
        expect(mockSendMail).toHaveBeenCalledTimes(1);
        
        // [Step 3] 발송된 이메일의 수신자가 맞는지 확인 (Test Oracle)
        const sentMailOptions = mockSendMail.mock.calls[0][0];
        expect(sentMailOptions.to).toBe('test@example.com');
        expect(sentMailOptions.subject).toContain('[경고] S1 이상 감지');
    });
});