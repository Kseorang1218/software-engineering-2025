#!/usr/bin/env python3
#
# 원본: Digiducer/Python 예제 (The Modal Shop)
# 수정: "2025 소공 프로젝트" GEM
#
# 기능:
# 1. 16kHz로 샘플링 (원본 예제 수정)
# 2. 1초(16000 샘플) 단위로 데이터 버퍼링
# 3. 16k 데이터로 통계 계산 (RMS, Crest Factor, Kurtosis, Skewness)
# 4. 1k 데이터로 다운샘플링 (scipy.signal.decimate 사용)
# 5. 계산된 통계값과 1k 데이터를 HTTP POST로 백엔드 서버에 전송 (비동기)
#

import numpy as np
import sounddevice as sd
import datetime
from sys import platform
import time
import queue
import requests  # HTTP 통신용
import scipy.signal  # 다운샘플링용
import scipy.stats  # 통계 계산용
import json
import threading  # 비동기 HTTP 전송용

# --- 프로젝트 설정 변수 ---
SAMPLE_RATE = 16000  # ‼️ 목표 샘플링 속도: 16kHz
DOWNSAMPLE_RATE = 1000  # 목표 다운샘플링 속도: 1kHz
DOWNSAMPLE_FACTOR = int(SAMPLE_RATE / DOWNSAMPLE_RATE)
BLOCK_SIZE = 1024  # 콜백에서 한 번에 받는 샘플 수 (하드웨어/드라이버에 따라 조절)
BUFFER_SECONDS = 1  # 1초 단위로 모아서 처리
BUFFER_SIZE = int(SAMPLE_RATE * BUFFER_SECONDS)  # 16000 샘플

# ‼️ 수정 필요: 실제 데이터를 수신할 백엔드 서버의 URL
SERVER_URL = "http://172.16.63.156:5000/api/vibration_data"

# 원본 예제의 eu_sen 및 eu_units (필요시 설정)
# (g 단위로 스케일링 할 경우)
eu_sen = np.array([100.0, 100.0])
eu_units = ["g", "g"]
# (스케일링 없이 Volts로 사용시 0.0)
# eu_sen = np.array([0.0, 0.0])
# eu_units = ["Volts", "Volts"]


# ##################################################################
# 
#  Digiducer/Python 예제 코드의 핵심 함수 (수정 없이 사용)
#  TMSFindDevices: The Modal Shop 장치를 찾는 필수 함수
#
# ##################################################################
def TMSFindDevices():
    # The Modal Shop model number substrings
    models=["485B", "333D", "633A", "SDC0"]
    
    if platform == "win32":         # Windows...
        hapis=sd.query_hostapis()
        api_num=0
        for api in hapis:
            if api['name'] == "Windows WDM-KS":
                break
            api_num += 1
    else:
        api_num=0
    devices = sd.query_devices()
    dev_info = []   
    dev_num=0
    for device in devices:
        if (device['hostapi'] == api_num):
            name = device['name']
            match = next((x for x in models if x in name), False)
            if match != False:
                loc = name.find(match)
                model = name[loc:loc+6] 
                fmt = name[loc+7:loc+8] 
                serialnum = name[loc+8:loc+14]  
                if fmt == "2" or fmt == '3':
                    form = 1    # Voltage
                    sens = [int(name[loc+14:loc+21]), int(name[loc+21:loc+28])]
                    if fmt == "3":  
                        sens[0] *= 20 
                        sens[1] *= 20 
                    scale = np.array([8388608.0/sens[0],
                                      8388608.0/sens[1]],
                                     dtype='float32') 
                    date = datetime.datetime.strptime(name[loc+28:loc+34], '%y%m%d') 
                elif fmt == "1":
                    form = 0 # Acceleration
                    sens = [int(name[loc+14:loc+19]), int(name[loc+19:loc+24])]
                    scale = np.array([855400.0/sens[0],
                                      855400.0/sens[1]],
                                      dtype='float32') 
                    date = datetime.datetime.strptime(name[loc+24:loc+30], '%y%m%d') 
                else:
                      raise FormatError("Expecting 1, 2, or 3 format")
                dev_info.append({"device":dev_num,\
                                 "model":model,\
                                 "serial_number":serialnum,\
                                 "date":date,\
                                 "format":form,\
                                 "sensitivity_int":sens,\
                                 "scale":scale,\
                                 })
        dev_num += 1
    if len(dev_info) == 0:
        raise Exception("No compatible TMS devices found") # 원본 예외 클래스 대신 기본 Exception 사용
    return dev_info

# ##################################################################
# 
#  데이터 수신 콜백 및 큐 (원본 예제와 동일)
#
# ##################################################################

# sounddevice 콜백 - 별도 스레드에서 실행됨
def callback(indata, frames, time, status):
    if status:
        print(status)
    # 수신된 데이터(numpy 배열)를 큐에 넣음
    q.put(indata.copy())  

# 데이터 공유를 위한 큐
q = queue.Queue() 

# ##################################################################
# 
#  프로젝트 요구사항 구현: 데이터 처리 및 HTTP 전송
#
# ##################################################################

def send_data_http(payload):
    """
    백엔드 서버로 데이터를 전송하는 함수 (별도 스레드에서 실행됨)
    """
    try:
        response = requests.post(SERVER_URL, json=payload, timeout=5.0) # 5초 타임아웃
        if response.status_code == 200 or response.status_code == 201:
            print(f"[{payload['sensor_id']}-CH{payload['channel']}] "
                  f"데이터 전송 성공 (RMS: {payload['statistics']['rms']:.4f})")
        else:
            print(f"서버 전송 실패: {response.status_code} - {response.text}")
    except requests.exceptions.RequestException as e:
        print(f"HTTP 요청 오류: {e}")

def process_data_buffer(buffer_16k, scale_factor, sensor_info, channel_index):
    """
    1초 분량의 16k 버퍼를 받아 통계 계산, 다운샘플링, HTTP 전송을 수행
    """
    # 1. 엔지니어링 단위(g 또는 V)로 스케일링
    sdata = buffer_16k * scale_factor
    
    # 2. 시간 통계값 계산 (16k 원본 데이터 기준)
    rms = np.sqrt(np.mean(sdata**2))
    peak = np.max(np.abs(sdata))
    crest_factor = peak / rms if rms != 0 else 0 
    kurtosis = scipy.stats.kurtosis(sdata)
    skewness = scipy.stats.skew(sdata)

    # 3. 1kHz로 다운샘플링 (앤티 앨리어싱 필터 포함)
    data_1k = scipy.signal.decimate(sdata, DOWNSAMPLE_FACTOR)
    
    # 4. 서버로 전송할 데이터 패키징 (JSON)
    payload = {
        "timestamp": datetime.datetime.now().isoformat(),
        "sensor_id": sensor_info['serial_number'],
        "model": sensor_info['model'],
        "channel": channel_index + 1, # 1-based index
        "units": units[channel_index],
        "statistics": {
            "rms": float(rms),
            "crest_factor": float(crest_factor),
            "kurtosis": float(kurtosis),
            "skewness": float(skewness)
        },
        "raw_data_1khz": data_1k.tolist() 
    }

    # 5. HTTP POST 요청 (별도 스레드에서 비동기 실행)
    # -> 메인 데이터 수집 루프가 네트워크 지연에 의해 중단되는 것을 방지
    send_thread = threading.Thread(target=send_data_http, args=(payload,))
    send_thread.start()

# ##################################################################
# 
#  메인 실행 루프
#
# ##################################################################

if __name__ == "__main__":
    try:
        # 1. 장치 찾기 (원본 예제 코드 활용)
        print("Finding TMS devices...")
        info = TMSFindDevices()
        print(f"Found {len(info)} device(s).")
        
        # 이 예제는 첫 번째 장치를 사용합니다.
        dev = 0 
        device_info = info[dev]
        print(f"Using device: {device_info['model']} (S/N: {device_info['serial_number']})")

        # 2. 데이터 스케일링 설정 (원본 예제 코드 활용)
        units = ["Volts", "Volts"]
        scale = device_info['scale']
        if device_info['format'] == 1: # Voltage
            for ch in range(len(scale)):
                if eu_sen[ch] != 0.0:
                    scale[ch] *= 1.0 / (eu_sen[ch]/1000.0)
                    units[ch] = eu_units[ch]
        elif device_info['format'] == 0: # Acceleration
            units = ["g", "g"]
        
        print(f"Channel 1 Units: {units[0]}, Channel 2 Units: {units[1]}")

        # 3. 데이터 수집 버퍼 초기화 (2채널)
        data_buffer = np.empty((0, 2), dtype='float32')

        # 4. InputStream 시작
        print(f"Starting stream at {SAMPLE_RATE} Hz (Blocksize: {BLOCK_SIZE})...")
        stream = sd.InputStream(
                device=device_info['device'], 
                channels=2,
                samplerate=SAMPLE_RATE,  # ‼️ 16kHz 설정
                dtype='float32', 
                blocksize=BLOCK_SIZE,  # ‼️ 1024 (원본 유지)
                callback=callback)
        
        stream.start()
        print("Monitoring started. Press Ctrl+C to stop.")

        # 5. 메인 루프 (데이터 수집 및 처리)
        while True:
            # 큐에서 데이터 가져오기 (콜백에서 넣어준 데이터)
            # 큐가 비어있으면 데이터가 들어올 때까지 여기서 대기
            data_chunk = q.get() 
            
            # 수집 버퍼에 데이터 추가
            data_buffer = np.concatenate((data_buffer, data_chunk), axis=0)
            
            # 버퍼가 1초(16000 샘플) 이상 모였는지 확인
            if data_buffer.shape[0] >= BUFFER_SIZE:
                
                # 정확히 1초 분량(BUFFER_SIZE)만 잘라내어 처리
                buffer_to_process = data_buffer[:BUFFER_SIZE]
                
                # 나머지 데이터는 다음 루프를 위해 남겨둠
                data_buffer = data_buffer[BUFFER_SIZE:]
                
                print(f"Processing 1-sec buffer ({buffer_to_process.shape[0]} samples)...")

                # 각 채널별로 데이터 처리 (2채널)
                ch_index = 1
                process_data_buffer(
                    buffer_to_process[:, ch_index], # 해당 채널의 16k 데이터
                    scale[ch_index],                # 해당 채널의 스케일 팩터
                    device_info,                    # 장치 정보
                    ch_index                        # 채널 번호 (0 or 1)
                )

    except KeyboardInterrupt:
        print("\nStopping stream...")
    except Exception as e:
        print(f"An error occurred: {e}")
    finally:
        if 'stream' in locals() and stream.active:
            stream.stop()
            stream.close()
        print("Client stopped.")