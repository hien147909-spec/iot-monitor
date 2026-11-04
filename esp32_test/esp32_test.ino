/*
 * IoT Monitor - ESP32 firmware
 * Sensors: DHT11 (temperature/humidity), LDR (light)
 * Outputs: three LEDs
 * MQTT topics: data_sensor, device_control, device_response
 *
 * Install Arduino libraries:
 *   - PubSubClient by Nick O'Leary
 *   - DHT sensor library by Adafruit
 *   - Adafruit Unified Sensor (dependency of DHT library)
 */

#include <WiFi.h>
#include <PubSubClient.h>
#include <DHT.h>

#define DHT_PIN 4
#define DHT_TYPE DHT11
#define LDR_PIN 34
#define LED1_PIN 25
#define LED2_PIN 26
#define LED3_PIN 27

// Set these values for the Wi-Fi network used by the ESP32.
const char* WIFI_SSID = "QuangBach1";
const char* WIFI_PASSWORD = "0962167662";

// Use the LAN IP of the computer running Mosquitto (not localhost/127.0.0.1).
const char* MQTT_SERVER = "192.168.88.239";
const int MQTT_PORT = 1883;
const char* MQTT_USER = "";       // Leave empty when the broker has no authentication.
const char* MQTT_PASSWORD = "";

const char* DEVICE_ID = "ESP32_01";
const char* TOPIC_SENSOR = "data_sensor";
const char* TOPIC_CONTROL = "device_control";
const char* TOPIC_RESPONSE = "device_response";

const unsigned long SENSOR_INTERVAL = 2000;
const unsigned long WIFI_RETRY_INTERVAL = 10000;
const unsigned long MQTT_RETRY_INTERVAL = 3000;

DHT dht(DHT_PIN, DHT_TYPE);
WiFiClient wifiClient;
PubSubClient mqttClient(wifiClient);

unsigned long lastSensorSend = 0;
unsigned long lastWiFiAttempt = 0;
unsigned long lastMqttAttempt = 0;

bool led1State = false;
bool led2State = false;
bool led3State = false;
bool sensorDisconnected = false;

int adcToLux(int adc) {
  // Calibrate these ADC endpoints for the exact LDR divider used in your circuit.
  int lux = map(adc, 3500, 500, 0, 1000);
  return constrain(lux, 0, 1000);
}

int readLightADC() {
  long total = 0;
  for (int i = 0; i < 10; i++) {
    total += analogRead(LDR_PIN);
    delay(5);
  }
  return total / 10;
}

void publishDeviceResponse(const char* requestId = "") {
  if (!mqttClient.connected()) return;

  char response[220];
  snprintf(
    response,
    sizeof(response),
    "{\"device_id\":\"%s\",\"request_id\":\"%s\",\"led1\":\"%s\",\"led2\":\"%s\",\"led3\":\"%s\",\"message\":\"SUCCESS\"}",
    DEVICE_ID,
    requestId,
    led1State ? "ON" : "OFF",
    led2State ? "ON" : "OFF",
    led3State ? "ON" : "OFF"
  );
  mqttClient.publish(TOPIC_RESPONSE, response, false);
}

void requestRestore() {
  if (!mqttClient.connected()) return;
  char request[120];
  snprintf(request, sizeof(request),
    "{\"device_id\":\"%s\",\"type\":\"RESTORE_REQUEST\"}",
    DEVICE_ID);
  mqttClient.publish(TOPIC_RESPONSE, request, false);
  Serial.println("Sent RESTORE_REQUEST to restore saved LED states");
}

void setLed(int ledNumber, bool state) {
  if (ledNumber == 1) {
    led1State = state;
    digitalWrite(LED1_PIN, state ? HIGH : LOW);
  } else if (ledNumber == 2) {
    led2State = state;
    digitalWrite(LED2_PIN, state ? HIGH : LOW);
  } else if (ledNumber == 3) {
    led3State = state;
    digitalWrite(LED3_PIN, state ? HIGH : LOW);
  }
}

void mqttCallback(char* topic, byte* payload, unsigned int length) {
  if (String(topic) != TOPIC_CONTROL) return;

  String message;
  message.reserve(length + 1);
  for (unsigned int i = 0; i < length; i++) message += (char)payload[i];
  message.trim();
  String requestId = "";
  const int separator = message.indexOf('|');
  if (separator >= 0) {
    requestId = message.substring(separator + 1);
    message = message.substring(0, separator);
  }
  message.toUpperCase();

  if (message == "LED1_ON") setLed(1, true);
  else if (message == "LED1_OFF") setLed(1, false);
  else if (message == "LED2_ON") setLed(2, true);
  else if (message == "LED2_OFF") setLed(2, false);
  else if (message == "LED3_ON") setLed(3, true);
  else if (message == "LED3_OFF") setLed(3, false);
  else if (message == "ALL_ON") {
    setLed(1, true);
    setLed(2, true);
    setLed(3, true);
  } else if (message == "ALL_OFF") {
    setLed(1, false);
    setLed(2, false);
    setLed(3, false);
  } else if (message == "STATUS") {
    publishDeviceResponse(requestId.c_str());
    return;
  } else if (message.startsWith("RESTORE:")) {
    // RESTORE:1,0,1 – restore saved LED states after reconnect
    String states = message.substring(8);
    int c1 = states.indexOf(',');
    int c2 = states.lastIndexOf(',');
    if (c1 > 0 && c2 > c1) {
      setLed(1, states.substring(0, c1) == "1");
      setLed(2, states.substring(c1 + 1, c2) == "1");
      setLed(3, states.substring(c2 + 1) == "1");
      Serial.printf("LED states restored: %d %d %d\n", led1State, led2State, led3State);
    }
  } else {
    Serial.print("Unknown MQTT command: ");
    Serial.println(message);
    return;
  }

  publishDeviceResponse(requestId.c_str());
}

void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;
  const unsigned long nowMs = millis();
  if (lastWiFiAttempt != 0 && nowMs - lastWiFiAttempt < WIFI_RETRY_INTERVAL) return;
  lastWiFiAttempt = nowMs == 0 ? 1 : nowMs;

  Serial.printf("Connecting to Wi-Fi: %s\n", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

void connectMQTT() {
  if (WiFi.status() != WL_CONNECTED || mqttClient.connected()) return;
  const unsigned long nowMs = millis();
  if (nowMs - lastMqttAttempt < MQTT_RETRY_INTERVAL) return;
  lastMqttAttempt = nowMs;

  Serial.printf("Connecting to MQTT %s:%d ...\n", MQTT_SERVER, MQTT_PORT);
  String clientId = String(DEVICE_ID) + "_" + String((uint32_t)ESP.getEfuseMac());
  
  // Last Will and Testament: if ESP32 power/USB wire is disconnected, broker immediately publishes this!
  char willPayload[160];
  snprintf(willPayload, sizeof(willPayload), "{\"device_id\":\"%s\",\"type\":\"LWT_OFFLINE\",\"message\":\"ESP32 mat ket noi hoac rut day nguon\"}", DEVICE_ID);

  bool connected;
  if (strlen(MQTT_USER) > 0) {
    connected = mqttClient.connect(clientId.c_str(), MQTT_USER, MQTT_PASSWORD, TOPIC_RESPONSE, 1, false, willPayload);
  } else {
    connected = mqttClient.connect(clientId.c_str(), TOPIC_RESPONSE, 1, false, willPayload);
  }

  if (connected) {
    Serial.println("MQTT connected");
    mqttClient.subscribe(TOPIC_CONTROL, 1);
    delay(100);
    requestRestore();
  } else {
    Serial.printf("MQTT connection failed, state=%d\n", mqttClient.state());
  }
}

void sendSensorData() {
  if (!mqttClient.connected()) return;

  const float temperature = dht.readTemperature();
  const float humidity = dht.readHumidity();

  // Wire pulled out check: DHT11 returns NaN immediately when wire is disconnected
  if (isnan(temperature) || isnan(humidity)) {
    Serial.println("CANH BAO: Day cam bien DHT11 bi rut ra!");
    sensorDisconnected = true;
    char alert[200];
    snprintf(
      alert,
      sizeof(alert),
      "{\"device_id\":\"%s\",\"type\":\"SENSOR_DISCONNECTED\",\"error\":\"DHT11_UNPLUGGED\",\"message\":\"Canh bao: Day cam bien DHT11 bi rut ra!\"}",
      DEVICE_ID
    );
    mqttClient.publish(TOPIC_RESPONSE, alert, false);
    return;
  }

  // If sensor wire was reconnected, send recovery notice
  if (sensorDisconnected) {
    sensorDisconnected = false;
    Serial.println("Day cam bien DHT11 da duoc cam lai");
    char recover[200];
    snprintf(
      recover,
      sizeof(recover),
      "{\"device_id\":\"%s\",\"type\":\"SENSOR_RECONNECTED\",\"message\":\"Day cam bien da duoc cam lai\"}",
      DEVICE_ID
    );
    mqttClient.publish(TOPIC_RESPONSE, recover, false);
  }

  const int lightADC = readLightADC();
  const int lux = adcToLux(lightADC);
  char data[220];
  snprintf(
    data,
    sizeof(data),
    "{\"device_id\":\"%s\",\"temperature\":%.1f,\"humidity\":%.1f,\"lux\":%d}",
    DEVICE_ID,
    temperature,
    humidity,
    lux
  );

  if (mqttClient.publish(TOPIC_SENSOR, data, false)) {
    Serial.println(data);
  } else {
    Serial.println("Failed to publish sensor data");
  }
}

void setup() {
  Serial.begin(115200);
  delay(300);

  pinMode(LED1_PIN, OUTPUT);
  pinMode(LED2_PIN, OUTPUT);
  pinMode(LED3_PIN, OUTPUT);
  setLed(1, false);
  setLed(2, false);
  setLed(3, false);

  dht.begin();
  analogReadResolution(12);

  mqttClient.setServer(MQTT_SERVER, MQTT_PORT);
  mqttClient.setCallback(mqttCallback);
  mqttClient.setBufferSize(512);
  mqttClient.setKeepAlive(5);
  connectWiFi();
}

void loop() {
  connectWiFi();
  connectMQTT();

  if (mqttClient.connected()) mqttClient.loop();

  const unsigned long nowMs = millis();
  if (nowMs - lastSensorSend >= SENSOR_INTERVAL) {
    lastSensorSend = nowMs;
    sendSensorData();
  }
  delay(5);
}
