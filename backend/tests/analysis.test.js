// [수정 포인트] 한 줄에서 performFFT와 diagnoseHealth를 동시에 가져옵니다.
const { performFFT, diagnoseHealth } = require('../services/analysisService');
const CONFIG = require('../config/constants');

// 1. 진단 로직 테스트 (기존 내용)
describe('진동 데이터 분석 로직 상세 테스트', () => {
    
    test('RMS가 낮을 때는 NORMAL 상태여야 한다', () => {
        const result = diagnoseHealth({ rms: 0.1, kurtosis: 2.0 });
        expect(result.status).toBe('NORMAL');
    });

    test('RMS가 정확히 경고 임계치(0.5)일 때 WARNING이어야 한다', () => {
        const result = diagnoseHealth({ rms: 0.5, kurtosis: 2.0 }); 
        expect(result.status).toBe('WARNING');
    });

    test('RMS가 정확히 위험 임계치(1.0)일 때 CRITICAL이어야 한다', () => {
        const result = diagnoseHealth({ rms: 1.0, kurtosis: 2.0 });
        expect(result.status).toBe('CRITICAL');
    });

    test('RMS는 경고, Kurtosis는 위험일 때, 더 높은 CRITICAL이 우선되어야 한다', () => {
        const result = diagnoseHealth({ rms: 0.6, kurtosis: 7.0 });
        
        expect(result.status).toBe('CRITICAL'); 
        expect(result.details).toContain('Elevated RMS');
        expect(result.details).toContain('Critical Kurtosis');
    });

    test('데이터가 0일 때도 정상 처리되어야 한다', () => {
        const result = diagnoseHealth({ rms: 0.0, kurtosis: 0.0 });
        expect(result.status).toBe('NORMAL');
    });
});

// 2. FFT 로직 테스트 (새로 추가된 부분)
describe('FFT 변환 로직 테스트', () => {
    test('입력 데이터 길이에 맞는 스펙트럼 데이터가 생성되어야 한다', () => {
        // 1024개의 0으로 채워진 더미 데이터 생성
        const rawData = new Array(1024).fill(0); 
        
        const spectrum = performFFT(rawData);

        // 검증 1: 결과가 배열인가?
        expect(Array.isArray(spectrum)).toBe(true);
        // 검증 2: FFT 사이즈의 절반(512개)만큼 데이터가 나오는가? (Nyquist 이론)
        expect(spectrum.length).toBe(512); 
        // 검증 3: 데이터 구조가 {x, y} 형태인가?
        expect(spectrum[0]).toHaveProperty('x');
        expect(spectrum[0]).toHaveProperty('y');
    });
});