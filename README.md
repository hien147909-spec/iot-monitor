# IoT Monitor — ESP32, MQTT, Node.js và SQLite

Ứng dụng giám sát nhiệt độ, độ ẩm và ánh sáng bằng dữ liệu ESP32 gửi lên MQTT. Backend nhận bản tin, kiểm tra dữ liệu, lưu vào SQLite; dashboard lấy dữ liệu qua REST API và tự cập nhật mỗi 5 giây. Không cần Firebase hay dịch vụ cloud.

## 1. Luồng hoạt động thực tế

```text
DHT11 + LDR + ESP32
        │ đọc cảm biến mỗi 5 giây
        ▼
  MQTT topic: data_sensor
        │
        ▼
  Mosquitto MQTT broker
        │
        ▼
 Node.js / Express backend ─────► SQLite
        │                            │
        │ REST API                   │ dữ liệu lịch sử
        ▼                            ▼
     Dashboard ◄─────────────────────┘

Dashboard ── REST API ──► Backend ── MQTT device_control ──► ESP32
Dashboard ◄─ REST API ─── Backend ◄─ MQTT device_response ─── ESP32
```

- **Dữ liệu biểu đồ:** chỉ lấy từ bảng `sensor_samples`; khi chạy chế độ MQTT, dữ liệu chỉ xuất hiện sau khi ESP32 gửi bản tin hợp lệ.
- **Biểu đồ:** ba dải riêng cho nhiệt độ, độ ẩm và ánh sáng, mỗi dải có thang đo riêng để không bị cắt khi độ ẩm trên 70% hoặc ánh sáng trên 800 lx.
- **Điều khiển LED:** backend gửi lệnh MQTT và chỉ ghi nhận thành công khi ESP32 phản hồi đúng `request_id` và trạng thái LED.
- **Lưu trữ:** mẫu cảm biến và lịch sử điều khiển được lưu trong SQLite, tồn tại sau khi khởi động lại ứng dụng.
- **Chế độ mô phỏng:** tắt mặc định. Khi bật, giao diện sẽ ghi rõ đây là dữ liệu giả lập, không phải dữ liệu từ board.

## 2. Chạy toàn bộ hệ thống bằng Docker (khuyến nghị)

Cần cài Docker Desktop (Windows/macOS) hoặc Docker Engine + Docker Compose (Linux).

1. Giải nén project, mở terminal tại thư mục `iot-monitor-project`.
2. Tạo file `.env`:

   ```powershell
   Copy-Item .env.example .env
   ```

   Trên macOS/Linux dùng `cp .env.example .env`.
3. Mở `.env`, đổi `JWT_SECRET` thành chuỗi bí mật dài và đổi `ADMIN_PASSWORD` trước khi sử dụng lâu dài.
4. Khởi động backend và MQTT broker:

   ```bash
   docker compose up --build -d
   ```
5. Mở `http://localhost:3000`. Tài khoản mặc định nếu chưa đổi trong `.env` là `admin` / `123456`.

Docker Compose tự chạy Mosquitto ở cổng `1883` và backend ở cổng `3000`. Backend kết nối broker bằng hostname nội bộ `mqtt`; ESP32 kết nối broker bằng địa chỉ IP LAN của máy tính chạy Docker.

nạp code:
C:\arduino-cli\arduino-cli.exe compile --fqbn esp32:esp32:esp32 "C:\Users\Admin\Downloads\iot-monitor-project\esp32_test"
upload:
C:\arduino-cli\arduino-cli.exe upload -p COM3 --fqbn esp32:esp32:esp32 --upload-property upload.speed=115200 "C:\Users\Admin\Downloads\iot-monitor-project\esp32_test"

Xem log nếu cần:

```bash
docker compose logs -f app mqtt
```

Dừng hệ thống:

```bash
docker compose down
```

Lệnh trên không xóa dữ liệu trong các Docker volume. Muốn xóa cả database và dữ liệu broker mới dùng `docker compose down -v`.

## 3. Cấu hình và nạp ESP32

### Phần cứng mẫu

| Linh kiện | Chân ESP32 | Ghi chú |
|---|---:|---|
| DHT11 DATA | GPIO 4 | VCC 3.3V hoặc theo module; GND chung |
| LDR analog | GPIO 34 | Dùng mạch chia áp LDR + điện trở, không đưa điện áp vượt mức ADC |
| LED 1 | GPIO 25 | Mắc điện trở hạn dòng |
| LED 2 | GPIO 26 | Mắc điện trở hạn dòng |
| LED 3 | GPIO 27 | Mắc điện trở hạn dòng |

Chỉnh sơ đồ chân trong `esp32/esp32_test.ino` nếu mạch thật khác. `adcToLux()` chỉ quy đổi ADC thành giá trị lux ước lượng; cần hiệu chuẩn bằng mạch và thiết bị đo thực tế nếu cần đơn vị lux chính xác.

### Cài đặt Arduino IDE

- Cài board package **ESP32 by Espressif Systems**.
- Cài thư viện **PubSubClient** của Nick O'Leary.
- Cài **DHT sensor library** của Adafruit và dependency **Adafruit Unified Sensor**.
- Mở `esp32/esp32_test.ino`, chọn đúng board ESP32 và đúng cổng COM.

ESP32 thường kết nối Wi-Fi **2.4 GHz**; hãy dùng SSID 2.4 GHz của router. Giữ `DEVICE_ID` là `ESP32_01` để khớp dashboard mặc định. Sửa bốn thông tin đầu file:

```cpp
const char* WIFI_SSID = "TEN_WIFI_2.4GHZ";
const char* WIFI_PASSWORD = "MAT_KHAU_WIFI";
const char* MQTT_SERVER = "192.168.1.100"; // IP LAN của máy tính chạy Docker
const int MQTT_PORT = 1883;
```

Lấy IP máy tính bằng `ipconfig` (Windows) hoặc `ip addr` (Linux). Điền IP LAN đang dùng, ví dụ `192.168.1.100`; **không** điền `localhost`, `127.0.0.1` hoặc hostname `mqtt` vào firmware. ESP32 và máy tính chạy Docker phải cùng mạng LAN hoặc có định tuyến cho phép truy cập cổng TCP `1883`. Cho phép cổng này qua firewall nếu hệ điều hành đang chặn.

Nếu Mosquitto được cấu hình xác thực, điền thêm `MQTT_USER` và `MQTT_PASSWORD` trong firmware, đồng thời cấu hình cùng username/password trong `.env` của backend. Cấu hình mặc định đi kèm chỉ cho phép anonymous trong mạng lab nội bộ; không mở broker này trực tiếp ra Internet.

Sau khi nạp firmware, mở Serial Monitor ở `115200 baud`. ESP32 sẽ kết nối Wi-Fi, kết nối MQTT, đăng ký topic điều khiển và gửi dữ liệu cảm biến mỗi 5 giây.

## 4. Chạy không dùng Docker

Cách này phù hợp khi đã cài Node.js 20+ và Mosquitto trực tiếp trên máy tính:

1. Cài và khởi động Mosquitto, lắng nghe TCP cổng `1883`.
2. Tạo `.env` từ `.env.example`, đặt:

   ```env
   MQTT_URL=mqtt://127.0.0.1:1883
   MQTT_SIMULATOR=false
   ```

3. Cài package và chạy ứng dụng:

   ```bash
   npm install
   npm start
   ```
4. Nạp firmware ESP32 theo mục 3, đặt `MQTT_SERVER` là IP LAN của máy tính.
5. Truy cập `http://localhost:3000`.

Nếu để `MQTT_URL` rỗng và `MQTT_SIMULATOR=false`, giao diện vẫn chạy nhưng sẽ không có dữ liệu cho tới khi broker và ESP32 gửi dữ liệu. Đây là hành vi đúng của chế độ phần cứng thật.

### Bật mô phỏng để kiểm tra khi chưa có ESP32

Chỉ bật khi muốn thử giao diện/API mà chưa có board:

```env
MQTT_URL=
MQTT_SIMULATOR=true
```

Khởi động lại Node.js. Dashboard sẽ hiển thị nhãn **MÔ PHỎNG (không phải ESP32)**. Tắt mô phỏng bằng cách đặt `MQTT_SIMULATOR=false` và khởi động lại.

## 5. Giao thức MQTT

Các topic mặc định được cấu hình ở `.env.example` và firmware. Tên topic phải giống nhau ở hai phía.

| Hướng | Topic | Ví dụ payload |
|---|---|---|
| ESP32 → backend | `data_sensor` | `{"device_id":"ESP32_01","temperature":27.4,"humidity":64.8,"lux":612}` |
| Backend → ESP32 | `device_control` | `LED1_ON\|<request_id>` |
| ESP32 → backend | `device_response` | `{"device_id":"ESP32_01","request_id":"42","led1":"ON","led2":"OFF","led3":"OFF","message":"SUCCESS"}` |

Lệnh hỗ trợ: `LED1_ON`, `LED1_OFF`, `LED2_ON`, `LED2_OFF`, `LED3_ON`, `LED3_OFF`, `ALL_ON`, `ALL_OFF`. Mỗi lệnh có dạng `TEN_LENH|request_id`; firmware trả lại `request_id` tương ứng.

Backend chỉ nhận mẫu cảm biến nếu `temperature`, `humidity`, `lux` là số hợp lệ (nhiệt độ -40..85 °C, độ ẩm 0..100%, ánh sáng 0..100000 lx). Mốc thời gian là thời điểm backend nhận được bản tin, lưu theo ISO 8601.

## 6. Kiểm tra kết nối

- API health: mở `http://localhost:3000/api/health`; trường `mqtt.brokerConnected` cho biết kết nối tới broker.
- Dashboard: `ESP32 đang kết nối` chỉ xuất hiện khi backend nhận dữ liệu/phản hồi từ thiết bị trong khoảng thời gian online đã cấu hình (`DEVICE_ONLINE_TIMEOUT_MS`, mặc định 20 giây).
- Dữ liệu: đăng nhập, vào **Dữ liệu cảm biến**; mỗi mẫu ESP32 tạo ba dòng nhiệt độ, độ ẩm và ánh sáng.
- Log: chạy `docker compose logs -f app mqtt`; backend ghi lỗi JSON/topic và trạng thái kết nối MQTT.
- Nếu broker kết nối nhưng dashboard chờ ESP32, kiểm tra Wi-Fi, `MQTT_SERVER`, firewall, chân DHT11/LDR và topic `data_sensor`.
- Nếu biểu đồ trống, kiểm tra Serial Monitor và bảo đảm backend cùng ESP32 sử dụng đúng topic.
- Nếu điều khiển LED timeout, kiểm tra topic `device_control`, `device_response`, dây LED và Serial Monitor.

## 7. API và Xác thực Token (Authentication)

Tất cả các endpoint API (ngoại trừ `/api/health` và `POST /api/auth/login`) đều được bảo vệ và **bắt buộc** truyền JWT token:
- Qua HTTP Header: `Authorization: Bearer <token>`
- Hoặc qua query param: `?token=<token>` (đối với EventSource/SSE)

Nếu thiếu token hoặc token không hợp lệ/hết hạn, backend trả về mã lỗi **HTTP 401 Unauthorized**.

| Method | Endpoint | Xác thực (Token) | Chức năng |
|---|---|---|---|
| GET | `/api/health` | Không bắt buộc | Trạng thái server backend và MQTT broker |
| POST | `/api/auth/login` | Public | Đăng nhập (username, password), nhận JWT Token |
| POST | `/api/auth/logout` | `Bearer <token>` | Đăng xuất, hủy phiên làm việc |
| GET | `/api/auth/me` | `Bearer <token>` | Xác minh phiên và thông tin tài khoản |
| GET | `/api/users/me` | `Bearer <token>` | Lấy hồ sơ người dùng đăng nhập |
| GET | `/api/dashboard/summary` | `Bearer <token>` | Thẻ số liệu mới nhất, chuỗi biểu đồ, trạng thái LED và online |
| GET | `/api/sensors/data?limit=30000` | `Bearer <token>` | Dữ liệu cảm biến để tra cứu, tìm kiếm, lọc và phân trang |
| GET | `/api/actions?limit=2000` | `Bearer <token>` | Lịch sử các thao tác điều khiển thiết bị |
| GET | `/api/devices/:id/led` | `Bearer <token>` | Trạng thái hiện tại của 3 đèn LED |
| POST | `/api/devices/:id/led` | `Bearer <token>` | Gửi lệnh điều khiển bật/tắt LED |
| GET | `/api/devices/:id/status` | `Bearer <token>` | Lấy trạng thái LED & kết nối đã lưu của thiết bị |
| GET | `/api/events` | `Bearer <token>` hoặc `?token=` | Server-Sent Events (SSE) đẩy cảnh báo & cảm biến thời gian thực |

Ví dụ body điều khiển LED 1:

```json
{ "led": 1, "state": true }
```

Bật/tắt tất cả LED:

```json
{ "led": "all", "state": false }
```

## 8. Cấu trúc dự án

```text
iot-monitor-project/
├── frontend/                 # HTML, CSS, JavaScript dashboard
├── backend/
│   ├── database/schema.sql   # SQLite schema
│   ├── data/                 # iot-monitor.db tự tạo khi chạy
│   └── src/                  # Express API, JWT, MQTT service
├── esp32/esp32_test.ino      # ESP32 + DHT11 + LDR + 3 LED
├── mosquitto/config/         # Cấu hình MQTT broker
├── .env.example
├── Dockerfile
└── docker-compose.yml
```

Database mặc định nằm ở `backend/data/iot-monitor.db` khi chạy Node trực tiếp; khi chạy Docker, dữ liệu nằm trong volume `app_data`. Sao lưu database/volume trước khi xóa hoặc chuyển máy.
