# 제목

2025-2 실시간 진동 데이터 웹 모니터링 시스템 

## 1. 개발 환경 

### 서버 
* **OS**: Ubuntu 22.04
* **Language**: Node.js v22.13.1
* **Dependencies**: `npm install`

### 게이트웨이
* **OS**: Window 11
* **Language**: Python 3.11.9
* **Dependencies**: `pip install -r collect_data/requirements.txt`


---

## 3. 폴더 구조
```text
├── backend/        # 백엔드 서버 코드
├── collect_data/   # 게이트웨이용 데이터 수집 및 전송 코드 
├── .gitignore           
└── README.md
```

---

## 4. 실행 방법 
1. 서버: ```node backend/server.js```
2. 게이트웨이: ```python collect_data/collect_data.py```