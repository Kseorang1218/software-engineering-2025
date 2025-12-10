// jest.config.js
module.exports = {
  // 테스트 환경을 명시적으로 'node'로 설정
  testEnvironment: 'node',
  
  // Node 22 이상 버전에서의 호환성 문제를 피하기 위한 설정
  testEnvironmentOptions: {
    // 필요한 경우 사용자 정의 환경 옵션 추가
  },
  
  // 터미널에 상세한 로그를 출력
  verbose: true,
};