/*
  InMoov - jambes motorisées : firmware Arduino Mega 2560
  =======================================================

  12 servos « bus » Feetech (protocole SMS/STS) : 6 par jambe
    1 hanche lacet   2 hanche roulis   3 hanche tangage
    4 genou          5 cheville tangage 6 cheville roulis
  Jambe gauche : ID 1 à 6, jambe droite : ID 11 à 16.

  Câblage
    - Serial1 (TX1 = 18, RX1 = 19) -> adaptateur bus Feetech (half-duplex) -> servos
    - Serial  (USB)                 -> Raspberry Pi 5 (legs_controller.py)
    - I2C (SDA = 20, SCL = 21)      -> centrale inertielle BNO085 dans le bassin
    - Broche 2                      -> bouton d'arrêt d'urgence (contact NF vers GND)

  Bibliothèques (gestionnaire de bibliothèques Arduino)
    - « SCServo » (Feetech / Waveshare)
    - « Adafruit BNO08x »

  SÉCURITÉ : ce firmware ne remplace PAS un vrai arrêt d'urgence qui coupe
  l'alimentation des servos, ni le portique auquel le robot doit être accroché.
  En cas de défaut, il FIGE les articulations (il ne coupe pas le couple,
  sinon le robot s'effondrerait) et refuse tout mouvement jusqu'à « RESET ».

  Protocole texte (115200 bauds, une commande par ligne)
    HB                          battement de cœur (à envoyer au moins 1 fois/s)
    MOVE <ms> <id>:<pos> ...    va aux positions (0..4095) en <ms> millisecondes
    HOLD                        fige toutes les articulations
    TORQUE <0|1> [id]           coupe / active le couple (tous ou un servo)
    STATUS                      renvoie l'état
    RESET                       efface un défaut (si sa cause a disparu)
  Réponses : « OK ... », « ERR ... », « FAULT ... », « S ... », « IMU ... », « STATE ... »
*/

#include <SCServo.h>
#include <Wire.h>
#include <Adafruit_BNO08x.h>

// ---------------------------------------------------------------- réglages
const uint8_t  NUM_JOINTS = 12;
const uint8_t  IDS[NUM_JOINTS] = {1, 2, 3, 4, 5, 6, 11, 12, 13, 14, 15, 16};

// Limites de position (0..4095). Chaque servo doit d'abord être calibré jambe
// tendue (milieu = 2048, voir README). Limites symétriques autour de 2048 pour
// fonctionner avec les deux sens de montage (jambe gauche / droite en miroir) :
//   hanche lacet ±30°, hanche roulis ±20°, hanche tangage ±60°,
//   genou ±75°, cheville tangage ±35°, cheville roulis ±20°   (1° = 11,4 pas)
// À RESSERRER selon votre mécanique : la Raspberry ne peut pas les dépasser.
const int16_t POS_MIN[NUM_JOINTS] = {1707, 1820, 1365, 1195, 1650, 1820,
                                     1707, 1820, 1365, 1195, 1650, 1820};
const int16_t POS_MAX[NUM_JOINTS] = {2389, 2276, 2731, 2901, 2446, 2276,
                                     2389, 2276, 2731, 2901, 2446, 2276};

const long     BUS_BAUD          = 1000000;  // STS : 1 Mbit/s par défaut (série SM en RS485 : 115200)
const long     USB_BAUD          = 115200;
const uint16_t MAX_SPEED         = 1500;     // pas/s (4096 pas = 1 tour)
const uint16_t MIN_SPEED         = 20;       // 0 = vitesse MAX pour les STS, on l'évite
const uint8_t  ACCEL             = 30;       // x100 pas/s²
const uint16_t MIN_MOVE_MS       = 300;
const uint32_t HEARTBEAT_TIMEOUT = 1000;     // ms sans HB -> défaut
const uint32_t FEEDBACK_PERIOD   = 100;      // ms entre deux lectures des servos
const int      MAX_TEMP_C        = 65;
const int      MAX_LOAD          = 850;      // sur 1000
const uint32_t MAX_LOAD_MS       = 800;      // surcharge tolérée pendant ...
const float    MAX_TILT_DEG      = 20.0;     // inclinaison du bassin
const uint8_t  ESTOP_PIN         = 2;

// ---------------------------------------------------------------- état
SMS_STS bus;
Adafruit_BNO08x imu;
sh2_SensorValue_t imuValue;
bool imuOk = false;
float imuRoll = 0, imuPitch = 0;

int16_t  curPos[NUM_JOINTS];
int      curLoad[NUM_JOINTS];
int      curTemp[NUM_JOINTS];
int      curVolt[NUM_JOINTS];
bool     posKnown[NUM_JOINTS];
uint32_t overloadSince[NUM_JOINTS];

bool     fault = false;
String   faultReason = "";
uint32_t lastHeartbeat = 0;
uint32_t lastFeedback = 0;
char     line[160];
uint8_t  lineLen = 0;

// déclarations (l'ordre des fonctions n'a ainsi aucune importance)
int  jointIndex(int id);
void raiseFault(const String &reason);
void holdAll();
void readServos();
void readImu();
void cmdMove(char *args);
void cmdTorque(char *args);
void cmdStatus();
void handleLine(char *cmd);

// ---------------------------------------------------------------- outils
int jointIndex(int id) {
  for (uint8_t i = 0; i < NUM_JOINTS; i++) if (IDS[i] == id) return i;
  return -1;
}

void raiseFault(const String &reason) {
  if (fault) return;  // déjà figé : on ne surcharge pas le bus
  fault = true;
  faultReason = reason;
  Serial.print(F("FAULT "));
  Serial.println(reason);
  holdAll();
}

// Fige chaque servo sur sa position actuelle (le couple reste actif).
void holdAll() {
  u8  ids[NUM_JOINTS];  // types de la bibliothèque SCServo
  s16 pos[NUM_JOINTS];
  u16 spd[NUM_JOINTS];
  u8  acc[NUM_JOINTS];
  uint8_t  n = 0;
  for (uint8_t i = 0; i < NUM_JOINTS; i++) {
    if (!posKnown[i]) continue;
    ids[n] = IDS[i];
    pos[n] = curPos[i];
    spd[n] = MIN_SPEED;
    acc[n] = ACCEL;
    n++;
  }
  if (n) bus.SyncWritePosEx(ids, n, pos, spd, acc);
}

// ---------------------------------------------------------------- capteurs
void readServos() {
  uint32_t now = millis();
  for (uint8_t i = 0; i < NUM_JOINTS; i++) {
    if (bus.FeedBack(IDS[i]) == -1) {
      raiseFault(String("servo ") + IDS[i] + " ne repond pas");
      continue;
    }
    curPos[i]  = bus.ReadPos(-1);
    curLoad[i] = bus.ReadLoad(-1);
    curTemp[i] = bus.ReadTemper(-1);
    curVolt[i] = bus.ReadVoltage(-1);
    posKnown[i] = true;

    if (curTemp[i] > MAX_TEMP_C) raiseFault(String("servo ") + IDS[i] + " trop chaud " + curTemp[i] + "C");

    if (abs(curLoad[i]) > MAX_LOAD) {
      if (overloadSince[i] == 0) overloadSince[i] = now;
      else if (now - overloadSince[i] > MAX_LOAD_MS) raiseFault(String("servo ") + IDS[i] + " surcharge " + curLoad[i]);
    } else {
      overloadSince[i] = 0;
    }
  }
}

void readImu() {
  if (!imuOk) return;
  if (imu.wasReset()) imu.enableReport(SH2_GAME_ROTATION_VECTOR, 20000);
  while (imu.getSensorEvent(&imuValue)) {
    if (imuValue.sensorId != SH2_GAME_ROTATION_VECTOR) continue;
    float w = imuValue.un.gameRotationVector.real;
    float x = imuValue.un.gameRotationVector.i;
    float y = imuValue.un.gameRotationVector.j;
    float z = imuValue.un.gameRotationVector.k;
    imuRoll  = atan2(2.0 * (w * x + y * z), 1.0 - 2.0 * (x * x + y * y)) * RAD_TO_DEG;
    float s  = constrain(2.0 * (w * y - z * x), -1.0, 1.0);
    imuPitch = asin(s) * RAD_TO_DEG;
  }
  if (fabs(imuRoll) > MAX_TILT_DEG || fabs(imuPitch) > MAX_TILT_DEG) {
    raiseFault(String("inclinaison ") + imuRoll + "/" + imuPitch);
  }
}

// ---------------------------------------------------------------- commandes
void cmdMove(char *args) {
  if (fault) { Serial.print(F("ERR en defaut : ")); Serial.println(faultReason); return; }

  char *tok = strtok(args, " ");
  if (!tok) { Serial.println(F("ERR MOVE <ms> <id>:<pos> ...")); return; }
  long ms = atol(tok);
  if (ms < MIN_MOVE_MS) ms = MIN_MOVE_MS;

  u8  ids[NUM_JOINTS];  // types de la bibliothèque SCServo
  s16 pos[NUM_JOINTS];
  u16 spd[NUM_JOINTS];
  u8  acc[NUM_JOINTS];
  uint8_t  n = 0;

  while ((tok = strtok(NULL, " ")) != NULL) {
    char *colon = strchr(tok, ':');
    if (!colon) { Serial.print(F("ERR format ")); Serial.println(tok); return; }
    *colon = 0;
    int id = atoi(tok);
    int target = atoi(colon + 1);
    int i = jointIndex(id);
    if (i < 0) { Serial.print(F("ERR id inconnu ")); Serial.println(id); return; }
    if (!posKnown[i]) { Serial.print(F("ERR position inconnue ")); Serial.println(id); return; }
    if (n >= NUM_JOINTS) { Serial.println(F("ERR trop d'articulations")); return; }

    target = constrain(target, POS_MIN[i], POS_MAX[i]);
    long dist = abs(target - curPos[i]);
    long speed = dist * 1000L / ms;               // pour que tout arrive en même temps
    speed = constrain(speed, MIN_SPEED, MAX_SPEED);

    ids[n] = id; pos[n] = target; spd[n] = speed; acc[n] = ACCEL;
    n++;
  }
  if (n == 0) { Serial.println(F("ERR aucune articulation")); return; }
  bus.SyncWritePosEx(ids, n, pos, spd, acc);
  Serial.print(F("OK MOVE ")); Serial.println(n);
}

void cmdTorque(char *args) {
  char *tok = strtok(args, " ");
  if (!tok) { Serial.println(F("ERR TORQUE <0|1> [id]")); return; }
  uint8_t on = atoi(tok) ? 1 : 0;
  tok = strtok(NULL, " ");
  if (tok) {
    int id = atoi(tok);
    if (jointIndex(id) < 0) { Serial.println(F("ERR id inconnu")); return; }
    bus.EnableTorque(id, on);
  } else {
    for (uint8_t i = 0; i < NUM_JOINTS; i++) bus.EnableTorque(IDS[i], on);
  }
  Serial.print(F("OK TORQUE ")); Serial.println(on);
}

void cmdStatus() {
  Serial.print(F("STATE ")); Serial.print(fault ? F("FAULT ") : F("READY "));
  Serial.println(faultReason);
  for (uint8_t i = 0; i < NUM_JOINTS; i++) {
    Serial.print(F("S ")); Serial.print(IDS[i]);
    Serial.print(' '); Serial.print(posKnown[i] ? curPos[i] : -1);
    Serial.print(' '); Serial.print(curLoad[i]);
    Serial.print(' '); Serial.print(curTemp[i]);
    Serial.print(' '); Serial.println(curVolt[i]);
  }
  Serial.print(F("IMU ")); Serial.print(imuOk ? 1 : 0);
  Serial.print(' '); Serial.print(imuRoll, 1);
  Serial.print(' '); Serial.println(imuPitch, 1);
  Serial.println(F("OK STATUS"));
}

void handleLine(char *cmd) {
  char *args = strchr(cmd, ' ');
  if (args) *args++ = 0; else args = cmd + strlen(cmd);

  if (!strcmp(cmd, "HB")) {
    lastHeartbeat = millis();
    Serial.println(F("OK HB"));
  } else if (!strcmp(cmd, "MOVE")) {
    lastHeartbeat = millis();
    cmdMove(args);
  } else if (!strcmp(cmd, "HOLD")) {
    holdAll();
    Serial.println(F("OK HOLD"));
  } else if (!strcmp(cmd, "TORQUE")) {
    cmdTorque(args);
  } else if (!strcmp(cmd, "STATUS")) {
    cmdStatus();
  } else if (!strcmp(cmd, "RESET")) {
    fault = false;
    faultReason = "";
    lastHeartbeat = millis();
    readServos();
    readImu();
    if (digitalRead(ESTOP_PIN) == HIGH) raiseFault("arret d'urgence enfonce");
    if (!fault) Serial.println(F("OK RESET"));
  } else if (cmd[0]) {
    Serial.print(F("ERR commande inconnue ")); Serial.println(cmd);
  }
}

// ---------------------------------------------------------------- Arduino
void setup() {
  Serial.begin(USB_BAUD);
  Serial1.begin(BUS_BAUD);
  bus.pSerial = &Serial1;
  bus.IOTimeOut = 20;  // ms : un servo absent ne bloque pas la boucle trop longtemps
  pinMode(ESTOP_PIN, INPUT_PULLUP);

  Wire.begin();
  imuOk = imu.begin_I2C();
  if (imuOk) imuOk = imu.enableReport(SH2_GAME_ROTATION_VECTOR, 20000);

  for (uint8_t i = 0; i < NUM_JOINTS; i++) { posKnown[i] = false; overloadSince[i] = 0; }
  readServos();

  // Au démarrage on est en défaut : la Raspberry doit envoyer RESET exprès.
  fault = false;
  raiseFault("demarrage (envoyer RESET)");
  if (!imuOk) Serial.println(F("ERR BNO085 absent : pas de detection de chute"));
  lastHeartbeat = millis();
}

void loop() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n' || c == '\r') {
      line[lineLen] = 0;
      if (lineLen) handleLine(line);
      lineLen = 0;
    } else if (lineLen < sizeof(line) - 1) {
      line[lineLen++] = c;
    }
  }

  uint32_t now = millis();
  if (digitalRead(ESTOP_PIN) == HIGH) raiseFault("arret d'urgence");
  if (!fault && now - lastHeartbeat > HEARTBEAT_TIMEOUT) raiseFault("plus de battement de coeur");

  if (now - lastFeedback >= FEEDBACK_PERIOD) {
    lastFeedback = now;
    readServos();
    readImu();
  }
}
