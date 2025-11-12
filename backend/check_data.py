import json
import matplotlib.pyplot as plt
import os

# 1. 파일 경로 설정
LOG_FILE = 'vibration_data.log'
PLOT_DIR = 'plots' # ‼️ 플롯을 저장할 'plots' 폴더 이름
PLOT_BASE_NAME = 'vibration_plot'

print(f"로그 파일 읽기: {LOG_FILE}")

# ‼️ 플롯을 저장할 'plots' 폴더 생성 (없으면)
if not os.path.exists(PLOT_DIR):
    os.makedirs(PLOT_DIR)
    print(f"'{PLOT_DIR}' 폴더를 생성했습니다.")

try:
    # 2. 로그 파일 열기
    with open(LOG_FILE, 'r') as f:
        
        plot_counter = 0 # ‼️ 플롯 파일 번호용 카운터
        
        # ‼️ 3. 파일의 모든 줄(line)에 대해 반복
        for line in f:
            
            # ‼️ 빈 줄이 있으면 건너뛰기
            if not line.strip():
                continue
                
            plot_counter += 1
            print(f"\n--- {plot_counter}번째 데이터 처리 중 ---")

            try:
                # 4. 읽어온 JSON 문자열을 파이썬 딕셔너리로 파싱
                data = json.loads(line)
                
                # 5. 'raw_data_1khz' 키로 원시 데이터 리스트 추출
                raw_data = data.get('raw_data_1khz')
                
                if raw_data is None:
                    print("오류: 'raw_data_1khz' 키를 찾을 수 없습니다. 건너뜁니다.")
                    continue # 다음 줄로 이동

                # 6. ‼️ 데이터 길이 확인
                data_length = len(raw_data)
                print(f"데이터 길이: {data_length} 샘플")

                # 7. ‼️ 데이터 플롯 생성 (Matplotlib)
                # (루프 안에서 매번 새 Figure를 생성)
                plt.figure(figsize=(12, 6)) 
                plt.plot(raw_data)
                
                timestamp = data.get('timestamp', 'Unknown Time')
                units = data.get('units', 'N/A')
                plt.title(f"Raw Vibration Data #{plot_counter} - {timestamp}")
                plt.xlabel("Sample Index (0-999)")
                plt.ylabel(f"Amplitude ({units})")
                plt.grid(True)
                
                # 8. ‼️ 고유한 이름으로 파일 저장
                # (예: 'plots/vibration_plot_1.png')
                plot_filename = os.path.join(PLOT_DIR, f"{PLOT_BASE_NAME}_{plot_counter}.png")
                plt.savefig(plot_filename)
                
                # ‼️ 9. (중요) 메모리 누수를 방지하기 위해 플롯 닫기
                plt.close() 
                
                print(f"성공: 플롯을 {plot_filename} 파일로 저장했습니다.")

            except json.JSONDecodeError:
                print(f"오류: {plot_counter}번째 줄의 JSON 형식이 잘못되었습니다. 건너뜁니다.")
            except Exception as e:
                print(f"오류: {plot_counter}번째 데이터 처리 중 오류 발생: {e}")

        if plot_counter == 0:
            print("오류: 로그 파일이 비어있거나 유효한 데이터가 없습니다.")
        else:
            print(f"\n총 {plot_counter}개의 데이터 처리를 완료했습니다.")


except FileNotFoundError:
    print(f"오류: {LOG_FILE} 파일을 찾을 수 없습니다.")
except Exception as e:
    print(f"알 수 없는 오류 발생: {e}")