# BÁO CÁO DỰ ÁN: HỆ THỐNG GIÁM SÁT IoT VÀ ĐIỀU KHIỂN THIẾT BỊ
**Học phần:** IoT và Ứng dụng (INT14149)  
**Giảng viên hướng dẫn:** TS. Nguyễn Quốc Uy  
**Sinh viên thực hiện:** Dương Văn Hướng  
**Mã sinh viên:** B23DCAT122  
**Lớp:** D23CQAT02-B — **Khoa:** An toàn thông tin  
**Repository:** [https://github.com/hien147909-spec/iot-monitor](https://github.com/hien147909-spec/iot-monitor)

---
C:\arduino-cli\arduino-cli.exe compile --fqbn esp32:esp32:esp32 "C:\Users\Admin\Downloads\iot-monitor-project\esp32_test"

C:\arduino-cli\arduino-cli.exe upload -p COM3 --fqbn esp32:esp32:esp32 --upload-property upload.speed=115200 "C:\Users\Admin\Downloads\iot-monitor-project\esp32_test"

docker compose up --build -d

## 1. Giới thiệu tổng quan

Dự án xây dựng hệ thống giám sát môi trường và điều khiển thiết bị phần cứng theo thời gian thực sử dụng vi điều khiển **ESP32**, giao thức truyền thông **MQTT**, máy chủ phụ trợ **Node.js/Express**, cơ sở dữ liệu **SQLite**, và giao diện điều khiển **Web Dashboard** chuẩn Responsive.

### Kiến trúc tổng thể hệ thống

```text
 ┌────────────────┐
 │     ESP32      │
 │  (DHT11, LDR,  │
 │     3 LEDs)    │
 └───────┬────────┘
         │ (MQTT: data_sensor, device_control, device_response)
         ▼
 ┌────────────────┐
 │ Mosquitto MQTT │
 │     Broker     │
 └───────┬────────┘
         │ (MQTT Client TCP:1883)
         ▼
 ┌────────────────┐      (SQLite WAL)      ┌────────────────┐
 │    Backend     │ ◄────────────────────► │  iot-monitor   │
 │ Node.js Express│                        │    database    │
 └───────┬────────┘                        └────────────────┘
         │ (REST API: Bearer JWT + Realtime SSE)
         ▼
 ┌────────────────┐
 │ Frontend Web   │
 │   Dashboard    │
 └────────────────┘
```

---

## 2. Cách đọc dữ liệu cảm biến trên ESP32

Mạch phần cứng sử dụng vi điều khiển **ESP32 NodeMCU** kết nối 2 loại cảm biến và 3 đèn LED báo hiệu:

| Linh kiện | Chân GPIO ESP32 | Chế độ / Giao tiếp | Chức năng |
|---|:---:|---|---|
| **DHT11** (Data) | `GPIO 4` | 1-Wire Digital | Đo nhiệt độ (°C) và độ ẩm không khí (%) |
| **LDR** (Quang trở) | `GPIO 34` | Analog (ADC1_CH6) | Đo cường độ ánh sáng môi trường (Lux) |
| **LED 1** | `GPIO 25` | Output (Digital) | Đèn điều khiển 1 |
| **LED 2** | `GPIO 26` | Output (Digital) | Đèn điều khiển 2 |
| **LED 3** | `GPIO 27` | Output (Digital) | Đèn điều khiển 3 |

### 2.1. Đọc cảm biến nhiệt độ & độ ẩm DHT11

* **Nguyên lý:** Sử dụng thư viện `DHT sensor library` (Adafruit) giao tiếp 1-Wire qua chân `GPIO 4`.
* **Chu kỳ đọc:** Đọc định kỳ mỗi **2 giây** (`SENSOR_INTERVAL = 2000`).
* **Hàm thực hiện:**
  ```cpp
  const float temperature = dht.readTemperature(); // Nhiệt độ (°C)
  const float humidity = dht.readHumidity();       // Độ ẩm (%)
  ```
* **Cơ chế phát hiện rút dây cảm biến tức thì:**
  * Khi dây tín hiệu DATA, VCC hoặc GND của DHT11 bị rút ra khỏi board mạch, thư viện Adafruit sẽ trả về giá trị `NaN` (`isnan(temperature) || isnan(humidity)`).
  * ESP32 lập tức phát hiện sự cố và phát bản tin MQTT cảnh báo ngay lập tức qua topic `device_response`:
    ```json
    {
      "device_id": "ESP32_01",
      "type": "SENSOR_DISCONNECTED",
      "error": "DHT11_UNPLUGGED",
      "message": "Canh bao: Day cam bien DHT11 bi rut ra!"
    }
    ```
  * Khi dây cảm biến được cắm lại, giá trị đo hợp lệ trở lại, ESP32 tự động gửi bản tin `SENSOR_RECONNECTED` để hệ thống tự xóa cảnh báo.

### 2.2. Đọc cảm biến ánh sáng LDR (Quang trở)

* **Nguyên lý:** Quang trở LDR được mắc theo mạch cầu phân áp với điện trở cố định $10\text{ k}\Omega$, điện áp đưa vào chân Analog `GPIO 34`.
* **Cấu hình ADC:** Cấu hình độ phân giải 12-bit (`analogReadResolution(12)`), cho dải giá trị ADC số từ `0` đến `4095`.
* **Kỹ thuật lọc nhiễu tín hiệu:** Lấy trung bình cộng 10 mẫu đo liên tiếp cách nhau 5ms:
  ```cpp
  int readLightADC() {
    long total = 0;
    for (int i = 0; i < 10; i++) {
      total += analogRead(LDR_PIN);
      delay(5);
    }
    return total / 10;
  }
  ```
* **Quy đổi sang đơn vị Lux:** Dùng hàm `map()` và `constrain()` theo đường chuẩn thực nghiệm:
  ```cpp
  int adcToLux(int adc) {
    int lux = map(adc, 3500, 500, 0, 1000);
    return constrain(lux, 0, 1000);
  }
  ```

### 2.3. Đóng gói bản tin cảm biến gửi lên MQTT

Dữ liệu đo được đóng gói thành chuỗi JSON và gửi định kỳ mỗi **2 giây** qua topic `data_sensor`:
```json
{
  "device_id": "ESP32_01",
  "temperature": 28.5,
  "humidity": 65.0,
  "lux": 420
}
```

### 2.4. Cơ chế Last Will and Testament (LWT) & Khôi phục trạng thái đèn

1. **Cảnh báo rút nguồn / ngắt kết nối ESP32 (LWT):**
   * Khi kết nối Mosquitto, ESP32 đăng ký bản tin di chúc (LWT) trên topic `device_response`:
     ```json
     {"device_id":"ESP32_01","type":"LWT_OFFLINE","message":"ESP32 mat ket noi hoac rut day nguon"}
     ```
   * Đặt `mqttClient.setKeepAlive(5)` giây. Khi ESP32 bị rút nguồn đột ngột, broker Mosquitto tự động phát bản tin LWT $\rightarrow$ Backend nhận được và kích hoạt cảnh báo đỏ trên Web trong vòng chưa đầy 1 giây.
2. **Khôi phục trạng thái đèn sau khi cắm lại dây:**
   * Khi cắm lại nguồn, ESP32 gửi bản tin `RESTORE_REQUEST`.
   * Backend tra cứu trạng thái LED gần nhất lưu trong SQLite và gửi lệnh `RESTORE:led1,led2,led3` qua `device_control`.
   * ESP32 nhận lệnh và khôi phục đúng trạng thái từng đèn như trước khi ngắt nguồn, không bị trở về 3 đèn tắt.

---

## 3. Biểu đồ giám sát 2 cột đơn vị (Dual Y-Axis)

Biểu đồ trên giao diện Dashboard được thiết kế theo chuẩn đồ thị kỹ thuật với **2 cột đơn vị**:

* **Cột đơn vị bên trái (Trục Y trái):**
  * Đơn vị: `°C / %`
  * Dành cho **Nhiệt độ** và **Độ ẩm**
  * Thang đo: `0`, `20`, `40`, `60`, `80`, `100` kèm vạch chia tick và nhãn rõ ràng.
* **Cột đơn vị bên phải (Trục Y phải):**
  * Đơn vị: `lx`
  * Dành riêng cho **Ánh sáng**
  * Thang đo: `0`, `200`, `400`, `600`, `800`, `1000` (tự động điều chỉnh linh hoạt).
* **Đặc tính kỹ thuật:**
  * Lưới tọa độ đồng bộ 6 vạch chia chính và các đường kẻ mờ phụ.
  * 3 đường vẽ sắc nét đại diện cho 3 đại lượng, kèm vùng đổ bóng gradient (Area Fill) tạo chiều sâu.
  * Điểm tròn (dots) trên từng mẫu đo và vòng sáng phát xung (pulse glow) tại giá trị mới nhất.
  * Tự động làm mới mỗi **2 giây** đồng bộ với tần suất đọc cảm biến của ESP32.
  * Hỗ trợ Crosshair (đường dóng dọc) và Tooltip hiển thị cả 3 thông số cùng lúc khi rê chuột.

---

## 4. Đặc tả chuẩn RESTful API & Xác thực (Authentication)

Tất cả các API nghiệp vụ đều yêu cầu xác thực bằng cơ chế **JWT Token (JSON Web Token)**:
* **Header chuẩn:** `Authorization: Bearer <token>`
* **Query param (dành riêng cho EventSource SSE):** `?token=<token>`
* **Thời hạn Token:** 12 giờ (`12h`).
* Nếu không truyền token hoặc token không hợp lệ, API trả về mã lỗi **HTTP 401 Unauthorized**.

### Bảng danh mục API hệ thống

| STT | Phương thức | Endpoint | Xác thực (Auth) | Mô tả chức năng |
|:---:|:---:|---|:---:|---|
| 1 | `POST` | `/api/auth/login` | **Basic Auth** / Body | Đăng nhập tài khoản, xác thực và cấp JWT Token |
| 2 | `POST` | `/api/auth/logout` | **Bearer Token** | Đăng xuất tài khoản, hủy phiên làm việc |
| 3 | `GET` | `/api/auth/me` | **Bearer Token** | Xác thực phiên và lấy thông tin tài khoản hiện tại |
| 4 | `GET` | `/api/users/me` | **Bearer Token** | Lấy thông tin hồ sơ người dùng |
| 5 | `GET` | `/api/dashboard/summary` | **Bearer Token** | Lấy số liệu mới nhất, 30 mẫu biểu đồ, trạng thái thiết bị |
| 6 | `GET` | `/api/sensors/data` | **Bearer Token** | Tra cứu, tìm kiếm, lọc và phân trang dữ liệu cảm biến |
| 7 | `GET` | `/api/actions` | **Bearer Token** | Lịch sử thao tác điều khiển thiết bị |
| 8 | `GET` | `/api/devices/:id/led` | **Bearer Token** | Lấy trạng thái hiện tại của 3 đèn LED |
| 9 | `POST` | `/api/devices/:id/led` | **Bearer Token** | Gửi lệnh điều khiển bật/tắt đèn LED |
| 10 | `GET` | `/api/devices/:id/status` | **Bearer Token** | Lấy trạng thái LED và kết nối đã lưu của thiết bị |
| 11 | `GET` | `/api/events` | **Bearer / ?token=** | Server-Sent Events (SSE) đẩy cảnh báo & dữ liệu thời gian thực |
| 12 | `GET` | `/api/health` | **Public** | Kiểm tra sức khỏe hệ thống và trạng thái kết nối MQTT broker |

---

### Chi tiết các Endpoint chính

#### 1. Đăng nhập (`POST /api/auth/login`)
* **Headers hỗ trợ:**
  * Cách 1 (HTTP Basic Auth): `Authorization: Basic <base64(username:password)>`
  * Cách 2: `Content-Type: application/json`
* **Request Body (khi không dùng Basic Auth Header):**
  ```json
  {
    "username": "admin",
    "password": "your_password"
  }
  ```
* **Response (HTTP 200 OK):**
  ```json
  {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "token_type": "Bearer",
    "expires_in": "12h",
    "user": {
      "id": 1,
      "username": "admin",
      "fullName": "Dương Văn Hướng",
      "studentId": "B23DCAT122",
      "email": "huongdv.b23dcat122@stu.ptit.edu.vn",
      "role": "admin"
    }
  }
  ```

#### 2. Dữ liệu tổng quan Dashboard (`GET /api/dashboard/summary`)
* **Headers:** `Authorization: Bearer <token>`
* **Query Parameters:** `deviceId` (mặc định: `ESP32_01`)
* **Response (HTTP 200 OK):**
  ```json
  {
    "deviceId": "ESP32_01",
    "current": {
      "temperature": 28.5,
      "humidity": 65.0,
      "lux": 420,
      "time": "2026-11-05T05:00:00.000Z"
    },
    "series": [
      { "t": 28.2, "h": 65.5, "l": 415, "time": "2026-11-05T04:59:02.000Z" },
      { "t": 28.5, "h": 65.0, "l": 420, "time": "2026-11-05T05:00:00.000Z" }
    ],
    "leds": [false, false, false],
    "online": true,
    "sensorAlert": null,
    "mqtt": {
      "mode": "mqtt",
      "connected": true,
      "brokerConnected": true
    },
    "lastCommand": {
      "id": 15,
      "action": "Bật đèn 1",
      "status": "ok",
      "sentAt": "2026-11-05T04:55:00.000Z",
      "respondedAt": "2026-11-05T04:55:00.400Z"
    },
    "updatedAt": "2026-11-05T05:00:00.000Z"
  }
  ```

#### 3. Điều khiển đèn LED (`POST /api/devices/:id/led`)
* **Headers:** `Authorization: Bearer <token>`, `Content-Type: application/json`
* **Request Body:**
  * Bật/tắt đèn đơn lẻ: `{"led": 1, "state": true}` (led: 1, 2, 3; state: true/false)
  * Bật/tắt tất cả: `{"led": "all", "state": false}`
* **Response (HTTP 202 Accepted):**
  ```json
  {
    "action": {
      "id": 16,
      "dev": "ESP32_01",
      "act": "Bật đèn 1",
      "st": "wait",
      "sent": "2026-11-05T05:02:00.000Z",
      "resp": null
    },
    "command": "LED1_ON|16",
    "message": "Đã tiếp nhận lệnh điều khiển."
  }
  ```

#### 4. Lấy trạng thái thiết bị đã lưu (`GET /api/devices/:id/status`)
* **Headers:** `Authorization: Bearer <token>`
* **Response (HTTP 200 OK):**
  ```json
  {
    "deviceId": "ESP32_01",
    "name": "ESP32_01",
    "leds": { "led1": true, "led2": false, "led3": false },
    "online": true,
    "lastSeen": "2026-11-05T05:00:00.000Z",
    "lastSensor": {
      "temperature": 28.5,
      "humidity": 65.0,
      "lux": 420,
      "time": "2026-11-05T05:00:00.000Z"
    },
    "mqtt": { "mode": "mqtt", "connected": true, "brokerConnected": true }
  }
  ```

#### 5. Stream sự kiện Realtime SSE (`GET /api/events`)
* **Headers:** `Authorization: Bearer <token>` hoặc Query `?token=<token>`
* **Content-Type:** `text/event-stream`
* **Các sự kiện đẩy tự động:**
  * `event: alert` $\rightarrow$ Bản tin cảnh báo rút dây cảm biến, ngắt nguồn thiết bị (`SENSOR_DISCONNECTED`, `LWT_OFFLINE`, `ONLINE`).
  * `event: sensor` $\rightarrow$ Dữ liệu cảm biến mới nhất đẩy về thời gian thực theo chu kỳ 2s.

---

## 5. Hướng dẫn cài đặt và vận hành

### Cách 1: Chạy bằng Docker Compose (Khuyến nghị)

Yêu cầu: Đã cài đặt Docker Desktop.

1. Mở terminal tại thư mục gốc của dự án:
   ```bash
   cd iot-monitor-project
   ```
2. Khởi chạy hệ thống:
   ```bash
   docker compose up --build -d
   ```
3. Truy cập Web Dashboard tại: `http://localhost:3000`
   * Tài khoản mặc định: `admin` / `123456`
4. Kiểm tra logs khi cần:
   ```bash
   docker compose logs -f app mqtt
   ```

### Cách 2: Chạy trực tiếp với Node.js & Mosquitto

1. Cài đặt các gói phụ thuộc:
   ```bash
   npm install
   ```
2. Khởi chạy Mosquitto Broker lắng nghe cổng `1883`.
3. Khởi động Backend:
   ```bash
   npm start
   ```

---

## 6. Hướng dẫn nạp Code cho ESP32

1. Mở file `esp32_test/esp32_test.ino` trong Arduino IDE hoặc qua `arduino-cli`.
2. Kiểm tra các thư viện cần thiết:
   * `PubSubClient` (Nick O'Leary)
   * `DHT sensor library` (Adafruit)
   * `Adafruit Unified Sensor`
3. Cập nhật thông số mạng Wi-Fi và địa chỉ IP của máy tính chạy broker MQTT:
   ```cpp
   const char* WIFI_SSID = "TEN_WIFI_2.4GHZ";
   const char* WIFI_PASSWORD = "MAT_KHAU_WIFI";
   const char* MQTT_SERVER = "192.168.1.xxx"; // Địa chỉ IP LAN máy tính (ipconfig)
   const int MQTT_PORT = 1883;
   ```
4. Chọn đúng Board **ESP32 Dev Module** và cổng COM tương ứng, nhấn **Upload** (hoặc `115200 baud`).

---

## 7. Cấu trúc thư mục dự án

```text
iot-monitor-project/
├── backend/
│   ├── database/
│   │   └── schema.sql       # Cấu trúc CSDL SQLite (users, devices, samples, history)
│   ├── src/
│   │   ├── config.js        # Cấu hình biến môi trường, cổng, timeout
│   │   ├── database.js      # Khởi tạo better-sqlite3 và tài khoản admin
│   │   ├── mqtt-service.js  # Xử lý kết nối MQTT, Watchdog, khôi phục đèn, cảnh báo
│   │   ├── routes.js        # Khai báo các API RESTful và xác thực JWT Bearer
│   │   └── server.js        # Khởi tạo Express server, SSE và bảo mật Helmet
│   └── data/                # iot-monitor.db lưu trữ dữ liệu
├── frontend/
│   ├── css/                 # CSS giao diện dashboard, layout, responsive
│   ├── js/
│   │   ├── common.js        # Xử lý API client, copy thời gian, SSE, banner cảnh báo
│   │   ├── dashboard.js     # Biểu đồ 2 cột đơn vị (Dual Y-Axis), điều khiển LED
│   │   ├── sensor.js        # Bảng dữ liệu cảm biến, tìm kiếm, phân trang
│   │   ├── history.js       # Lịch sử điều khiển thiết bị
│   │   └── login.js         # Đăng nhập Basic Auth, tài liệu API modal
│   └── index.html           # Giao diện chính của ứng dụng Web
├── esp32_test/
│   └── esp32_test.ino       # Firmware ESP32 (DHT11, LDR, 3 LED, MQTT, LWT, Restore)
├── mosquitto/
│   └── config/
│       └── mosquitto.conf   # Cấu hình MQTT Broker Mosquitto
├── docker-compose.yml       # Điều phối Docker containers (app + mosquitto)
├── Dockerfile               # Đóng gói ứng dụng backend
├── package.json             # Danh sách dependencies và script kiểm tra
└── README.md                # Tài liệu hướng dẫn và báo cáo dự án
```
