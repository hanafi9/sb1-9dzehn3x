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
    - Broches 22 à 37               -> 8 modules HX711 (4 cellules de charge par pied)
        cellule n : DOUT = 22 + 2n, SCK = 23 + 2n
        ordre : pied gauche avant-ext, avant-int, arrière-ext, arrière-int (0..3),
                pied droit  avant-ext, avant-int, arrière-ext, arrière-int (4..7)
        broche RATE des HX711 à 5 V (80 mesures/s au lieu de 10)

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
    FEET                        état des pieds et de l'équilibre (une ligne « F ... »)
    TARE                        zéro des cellules (pieds EN L'AIR, robot sur le portique)
    CAL <cellule> <grammes>     étalonne une cellule avec une masse connue posée dessus
    BALCFG kp kd kc max contact sp sr d5 d6 d15 d16   réglages de l'équilibre (voir legs_controller.py)
    BAL <0|1|2>                 équilibre : 0 arrêt, 1 actif (chevilles), 2 surveillance seule
  Réponses : « OK ... », « ERR ... », « FAULT ... », « S ... », « IMU ... », « STATE ... »,
             « F ... », « CELL ... », « BAL ... »

  Équilibre (stratégie de cheville) : 50 fois par seconde, une petite correction
  est ajoutée aux chevilles d'après l'inclinaison du bassin (BNO085), sa vitesse
  (gyroscope) et le centre de pression des pieds (cellules de charge). La
  correction est bornée (« max » degrés), progressive, et revient à zéro dès que
  les pieds ne touchent plus le sol (robot soulevé) ou en cas de défaut.
*/

#include <SCServo.h>
#include <Wire.h>
#include <Adafruit_BNO08x.h>
#include <EEPROM.h>

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

// pieds : 4 cellules de charge par pied, chacune avec son HX711
const uint8_t  NUM_CELLS         = 8;
const uint8_t  CELL_PIN0         = 22;      // DOUT = 22 + 2n, SCK = 23 + 2n
const uint32_t CELL_TIMEOUT_MS   = 500;     // pas de mesure depuis ... -> cellule absente
const uint16_t EEPROM_MAGIC      = 0x4C47;  // « LG »

// équilibre
const uint32_t BAL_PERIOD        = 20;      // ms (50 Hz)
const float    BAL_SLEW_DEG      = 1.0;     // variation max de la correction par cycle
const float    STEPS_PER_DEG     = 4096.0 / 360.0;
// index (dans IDS) des chevilles : gauche tangage, gauche roulis, droite tangage, droite roulis
const uint8_t  ANKLE[4]          = {4, 5, 10, 11};

// ---------------------------------------------------------------- état
SMS_STS bus;
Adafruit_BNO08x imu;
sh2_SensorValue_t imuValue;
bool imuOk = false;
float imuRoll = 0, imuPitch = 0;
float gyroRoll = 0, gyroPitch = 0;          // deg/s

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

// cellules de charge (zéro et échelle gardés en EEPROM)
struct CellCal { uint16_t magic; long zero[NUM_CELLS]; float countsPerKg[NUM_CELLS]; };
CellCal  cal;
long     cellRaw[NUM_CELLS];
uint32_t cellSeen[NUM_CELLS];
float    cellKg[NUM_CELLS];

// pieds : charge (kg), centre de pression avant(+)/arrière(-) et extérieur(+)/intérieur(-)
float footKg[2], footCopX[2], footCopY[2];
bool  feetOk = false;

// équilibre
uint8_t  balMode = 0;
float    kp = 0.3, kd = 0.02, kc = 3.0, balMax = 5.0, contactKg = 1.0;
float    signPitch = 1, signRoll = 1;
float    ankleDir[4] = {1, 1, 1, 1};
float    corrPitch = 0, corrRoll = 0;
uint32_t lastBal = 0;
// trajectoire « de base » des chevilles quand l'équilibre est actif
int16_t  ankleFrom[4], ankleTo[4];
uint32_t ankleT0[4], ankleDur[4];
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
void printFeet();
void cmdBalCfg(char *args);
void cmdBal(char *args);
void cmdTare();
void cmdCal(char *args);
int16_t ankleBase(uint8_t a, uint32_t now);
float slew(float current, float target);
void saveCal();
void handleLine(char *cmd);
void readCells();
void computeFeet();
void balanceStep();
void startAnkleBase();

// ---------------------------------------------------------------- outils
int jointIndex(int id) {
  for (uint8_t i = 0; i < NUM_JOINTS; i++) if (IDS[i] == id) return i;
  return -1;
}

void raiseFault(const String &reason) {
  if (fault) return;  // déjà figé : on ne surcharge pas le bus
  fault = true;
  balMode = 0;        // plus de correction d'équilibre
  corrPitch = corrRoll = 0;
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
  if (imu.wasReset()) {
    imu.enableReport(SH2_GAME_ROTATION_VECTOR, 20000);
    imu.enableReport(SH2_GYROSCOPE_CALIBRATED, 20000);
  }
  while (imu.getSensorEvent(&imuValue)) {
    if (imuValue.sensorId == SH2_GYROSCOPE_CALIBRATED) {
      gyroRoll  = imuValue.un.gyroscope.x * RAD_TO_DEG;
      gyroPitch = imuValue.un.gyroscope.y * RAD_TO_DEG;
      continue;
    }
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

// Lit chaque HX711 qui a une mesure prête (24 bits, 25 impulsions = voie A, gain 128).
void readCells() {
  uint32_t now = millis();
  for (uint8_t n = 0; n < NUM_CELLS; n++) {
    uint8_t dout = CELL_PIN0 + 2 * n, sck = dout + 1;
    if (digitalRead(dout) == HIGH) continue;  // pas encore prête
    long v = 0;
    noInterrupts();                           // SCK haut > 60 µs = mise en veille du HX711
    for (uint8_t b = 0; b < 24; b++) {
      digitalWrite(sck, HIGH);
      delayMicroseconds(1);
      v = (v << 1) | digitalRead(dout);
      digitalWrite(sck, LOW);
      delayMicroseconds(1);
    }
    digitalWrite(sck, HIGH);
    delayMicroseconds(1);
    digitalWrite(sck, LOW);
    interrupts();
    if (v & 0x800000L) v |= 0xFF000000L;      // nombre signé sur 24 bits
    cellRaw[n] = v;
    cellSeen[n] = now;
    float k = cal.countsPerKg[n];
    cellKg[n] = k != 0 ? (v - cal.zero[n]) / k : 0;
    if (cellKg[n] < 0) cellKg[n] = 0;
  }
}

void computeFeet() {
  uint32_t now = millis();
  feetOk = true;
  for (uint8_t n = 0; n < NUM_CELLS; n++)
    if (cellSeen[n] == 0 || now - cellSeen[n] > CELL_TIMEOUT_MS || cal.countsPerKg[n] == 0) feetOk = false;
  for (uint8_t f = 0; f < 2; f++) {
    const float *c = &cellKg[4 * f];          // avant-ext, avant-int, arrière-ext, arrière-int
    float total = c[0] + c[1] + c[2] + c[3];
    footKg[f] = total;
    if (total > 0.2) {
      footCopX[f] = (c[0] + c[1] - c[2] - c[3]) / total;
      footCopY[f] = (c[0] + c[2] - c[1] - c[3]) / total;
    } else {
      footCopX[f] = footCopY[f] = 0;
    }
  }
}

// Position de base d'une cheville (le mouvement demandé par MOVE, interpolé).
int16_t ankleBase(uint8_t a, uint32_t now) {
  uint32_t t = now - ankleT0[a];
  if (t >= ankleDur[a]) return ankleTo[a];
  return ankleFrom[a] + (long)(ankleTo[a] - ankleFrom[a]) * (long)t / (long)ankleDur[a];
}

void startAnkleBase() {
  uint32_t now = millis();
  for (uint8_t a = 0; a < 4; a++) {
    ankleFrom[a] = ankleTo[a] = curPos[ANKLE[a]];
    ankleT0[a] = now;
    ankleDur[a] = 1;
  }
}

float slew(float current, float target) {
  return current + constrain(target - current, -BAL_SLEW_DEG, BAL_SLEW_DEG);
}

// Stratégie de cheville : redresser le bassin et ramener le centre de pression au milieu des pieds.
void balanceStep() {
  float targetPitch = 0, targetRoll = 0;
  bool contact = feetOk ? (footKg[0] > contactKg || footKg[1] > contactKg) : imuOk;
  if (balMode != 0 && !fault && imuOk && contact) {
    float lean  = signPitch * imuPitch, leanRate = signPitch * gyroPitch;  // + = penche en avant
    float side  = signRoll * imuRoll,   sideRate = signRoll * gyroRoll;    // + = penche à droite
    float cop = 0;
    if (feetOk) {
      float w = footKg[0] + footKg[1];
      if (w > 0.2) cop = (footKg[0] * footCopX[0] + footKg[1] * footCopX[1]) / w;  // + = vers les pointes
    }
    // penché en avant / appui sur les pointes -> pointes des pieds vers le bas (cheville_tangage négatif)
    targetPitch = -(kp * lean + kd * leanRate + kc * cop);
    // penché à droite -> chevilles inclinées pour repousser le corps vers la gauche
    targetRoll  = -(kp * side + kd * sideRate);
    targetPitch = constrain(targetPitch, -balMax, balMax);
    targetRoll  = constrain(targetRoll, -balMax, balMax);
  }
  corrPitch = slew(corrPitch, targetPitch);
  corrRoll  = slew(corrRoll, targetRoll);
  if (fault || balMode != 1) return;

  uint32_t now = millis();
  u8  ids[4];
  s16 pos[4];
  u16 spd[4];
  u8  acc[4];
  for (uint8_t a = 0; a < 4; a++) {
    uint8_t i = ANKLE[a];
    float deg = (a % 2 == 0) ? corrPitch : corrRoll;
    long target = ankleBase(a, now) + (long)(ankleDir[a] * deg * STEPS_PER_DEG);
    ids[a] = IDS[i];
    pos[a] = constrain(target, POS_MIN[i], POS_MAX[i]);
    spd[a] = MAX_SPEED;
    acc[a] = ACCEL;
  }
  bus.SyncWritePosEx(ids, 4, pos, spd, acc);
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
  uint8_t total = n;
  if (balMode == 1) {
    // équilibre actif : les chevilles suivent le mouvement via balanceStep()
    uint32_t now = millis();
    uint8_t keep = 0;
    for (uint8_t k = 0; k < n; k++) {
      int a = -1;
      for (uint8_t j = 0; j < 4; j++) if (IDS[ANKLE[j]] == ids[k]) a = j;
      if (a >= 0) {
        ankleFrom[a] = ankleBase(a, now);
        ankleTo[a] = pos[k];
        ankleT0[a] = now;
        ankleDur[a] = ms;
      } else {
        ids[keep] = ids[k]; pos[keep] = pos[k]; spd[keep] = spd[k]; acc[keep] = acc[k];
        keep++;
      }
    }
    n = keep;
  }
  if (n) bus.SyncWritePosEx(ids, n, pos, spd, acc);
  Serial.print(F("OK MOVE ")); Serial.println(total);
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
  for (uint8_t n = 0; n < NUM_CELLS; n++) {
    Serial.print(F("CELL ")); Serial.print(n);
    Serial.print(' '); Serial.print(cellRaw[n]);
    Serial.print(' '); Serial.println(cellKg[n], 2);
  }
  printFeet();
  Serial.println(F("OK STATUS"));
}

// F <ok> <kg G> <copX G> <copY G> <kg D> <copX D> <copY D> <mode> <corr tangage> <corr roulis> <roulis> <tangage>
void printFeet() {
  Serial.print(F("F ")); Serial.print(feetOk ? 1 : 0);
  for (uint8_t f = 0; f < 2; f++) {
    Serial.print(' '); Serial.print(footKg[f], 2);
    Serial.print(' '); Serial.print(footCopX[f], 2);
    Serial.print(' '); Serial.print(footCopY[f], 2);
  }
  Serial.print(' '); Serial.print(balMode);
  Serial.print(' '); Serial.print(corrPitch, 1);
  Serial.print(' '); Serial.print(corrRoll, 1);
  Serial.print(' '); Serial.print(imuRoll, 1);
  Serial.print(' '); Serial.println(imuPitch, 1);
}

void cmdBalCfg(char *args) {
  float v[11];
  char *tok = strtok(args, " ");
  for (uint8_t k = 0; k < 11; k++) {
    if (!tok) { Serial.println(F("ERR BALCFG kp kd kc max contact sp sr d5 d6 d15 d16")); return; }
    v[k] = atof(tok);
    tok = strtok(NULL, " ");
  }
  if (v[0] < 0 || v[1] < 0 || v[2] < 0 || v[3] < 0 || v[3] > 10 || v[4] < 0) {
    Serial.println(F("ERR BALCFG valeurs hors limites (max <= 10 degres)"));
    return;
  }
  kp = v[0]; kd = v[1]; kc = v[2]; balMax = v[3]; contactKg = v[4];
  signPitch = v[5] < 0 ? -1 : 1;
  signRoll  = v[6] < 0 ? -1 : 1;
  for (uint8_t a = 0; a < 4; a++) ankleDir[a] = v[7 + a] < 0 ? -1 : 1;
  Serial.println(F("OK BALCFG"));
}

void cmdBal(char *args) {
  int mode = atoi(args);
  if (mode < 0 || mode > 2) { Serial.println(F("ERR BAL <0|1|2>")); return; }
  if (mode == 1 && fault) { Serial.print(F("ERR en defaut : ")); Serial.println(faultReason); return; }
  if (mode == 1 && !imuOk) { Serial.println(F("ERR BNO085 absent")); return; }
  if (mode == 1 && balMode != 1) startAnkleBase();
  if (mode != 1 && balMode == 1) {
    // retour doux des chevilles sur leur position de base
    uint32_t now = millis();
    u8 ids[4]; s16 pos[4]; u16 spd[4]; u8 acc[4];
    for (uint8_t a = 0; a < 4; a++) {
      ids[a] = IDS[ANKLE[a]]; pos[a] = ankleBase(a, now); spd[a] = 200; acc[a] = ACCEL;
    }
    if (!fault) bus.SyncWritePosEx(ids, 4, pos, spd, acc);
    corrPitch = corrRoll = 0;
  }
  balMode = mode;
  Serial.print(F("OK BAL ")); Serial.println(balMode);
}

void saveCal() { cal.magic = EEPROM_MAGIC; EEPROM.put(0, cal); }

void cmdTare() {
  uint32_t now = millis();
  for (uint8_t n = 0; n < NUM_CELLS; n++) {
    if (cellSeen[n] == 0 || now - cellSeen[n] > CELL_TIMEOUT_MS) {
      Serial.print(F("ERR cellule absente ")); Serial.println(n); return;
    }
  }
  for (uint8_t n = 0; n < NUM_CELLS; n++) cal.zero[n] = cellRaw[n];
  saveCal();
  Serial.println(F("OK TARE"));
}

void cmdCal(char *args) {
  char *tok = strtok(args, " ");
  char *grams = strtok(NULL, " ");
  if (!tok || !grams) { Serial.println(F("ERR CAL <cellule 0..7> <grammes>")); return; }
  int n = atoi(tok);
  float kg = atof(grams) / 1000.0;
  if (n < 0 || n >= NUM_CELLS || kg < 0.1) { Serial.println(F("ERR CAL cellule 0..7, masse >= 100 g")); return; }
  long net = cellRaw[n] - cal.zero[n];
  if (labs(net) < 100) { Serial.println(F("ERR CAL presque aucun signal : masse posee ? cellule branchee ?")); return; }
  cal.countsPerKg[n] = net / kg;
  saveCal();
  Serial.print(F("OK CAL ")); Serial.print(n); Serial.print(' '); Serial.println(cal.countsPerKg[n], 1);
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
    balMode = 0;  // FIGER = plus aucune correction
    corrPitch = corrRoll = 0;
    holdAll();
    Serial.println(F("OK HOLD"));
  } else if (!strcmp(cmd, "TORQUE")) {
    cmdTorque(args);
  } else if (!strcmp(cmd, "STATUS")) {
    cmdStatus();
  } else if (!strcmp(cmd, "FEET")) {
    printFeet();
  } else if (!strcmp(cmd, "TARE")) {
    cmdTare();
  } else if (!strcmp(cmd, "CAL")) {
    cmdCal(args);
  } else if (!strcmp(cmd, "BALCFG")) {
    cmdBalCfg(args);
  } else if (!strcmp(cmd, "BAL")) {
    cmdBal(args);
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
  if (imuOk) imu.enableReport(SH2_GYROSCOPE_CALIBRATED, 20000);

  for (uint8_t n = 0; n < NUM_CELLS; n++) {
    pinMode(CELL_PIN0 + 2 * n, INPUT);
    pinMode(CELL_PIN0 + 2 * n + 1, OUTPUT);
    digitalWrite(CELL_PIN0 + 2 * n + 1, LOW);
    cellRaw[n] = 0; cellSeen[n] = 0; cellKg[n] = 0;
  }
  EEPROM.get(0, cal);
  if (cal.magic != EEPROM_MAGIC) {
    for (uint8_t n = 0; n < NUM_CELLS; n++) { cal.zero[n] = 0; cal.countsPerKg[n] = 0; }
  }

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

  readCells();
  if (now - lastBal >= BAL_PERIOD) {
    lastBal = now;
    readImu();
    computeFeet();
    balanceStep();
  }
  if (now - lastFeedback >= FEEDBACK_PERIOD) {
    lastFeedback = now;
    readServos();
  }
}
