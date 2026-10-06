# InMoov : Raspberry Pi 5 + Coral USB

Deux programmes qui tournent **à côté de MyRobotLab (Nixie)** sur le Raspberry Pi 5
et lui parlent par son API REST (`http://127.0.0.1:8888/api/service/...`) :

| Programme | Rôle | Python |
|---|---|---|
| `vision/face_tracker.py` | Caméra USB → Coral USB → tourne `rothead` / `neck` vers le visage le plus proche | **3.9** (obligatoire pour PyCoral) |
| `voice/speech_listener.py` | Micro → détection de voix → Whisper → commandes locales, **IA Claude** ou chatbot `i01.chatBot` | 3.11 (celui du système) |
| `voice/llm_brain.py` | IA conversationnelle (Claude) qui remplace le chatbot AIML et peut bouger la tête et les mains | 3.11 |
| `legs/` | Jambes motorisées : firmware Arduino Mega, pilotage depuis le Pi, calcul des moteurs | Arduino + 3.11 |

```
 Caméra USB ─► face_tracker.py (Coral) ──┐  POST /api/service/i01.head.rothead/moveTo [95.0]
                                         ├─► MyRobotLab Nixie (InMoov2) ─► Arduino Mega ─► servos
 Micro USB ──► speech_listener.py ───────┘  POST /api/service/i01.chatBot/getResponse ["bonjour"]
                                                         └─► htmlFilter ─► i01.mouth (synthèse vocale)
```

## 1. Préparer le Raspberry Pi 5

- Raspberry Pi OS **64 bits** (Bookworm), alimentation officielle **5 V / 5 A**
  (sinon les ports USB sont limités à 600 mA, insuffisant pour Coral + caméra + micro).
- Brancher le **Coral USB sur un port USB 3 (bleu)**.
- MyRobotLab Nixie installé et InMoov2 démarré (WebGui sur le port 8888).
- **Désactiver le suivi de visage intégré d'InMoov2** pour ne pas avoir deux programmes qui
  bougent la tête en même temps.

Copier ce dossier sur le Pi, par exemple dans `/home/pi/inmoov`, puis :

```bash
cd /home/pi/inmoov
cp config.example.json config.json   # puis l'adapter à votre robot
```

## 2. Vision : Coral USB + suivi de visage

### Pilote Edge TPU

```bash
sudo mkdir -p /etc/apt/keyrings
curl -fsSL https://packages.cloud.google.com/apt/doc/apt-key.gpg | sudo gpg --dearmor -o /etc/apt/keyrings/coral.gpg
echo "deb [signed-by=/etc/apt/keyrings/coral.gpg] https://packages.cloud.google.com/apt coral-edgetpu-stable main" \
  | sudo tee /etc/apt/sources.list.d/coral-edgetpu.list
sudo apt update
sudo apt install libedgetpu1-std     # libedgetpu1-max = plus rapide mais chauffe beaucoup
```

Débrancher puis rebrancher le Coral. `lsusb` doit afficher `1a6e:089a Global Unichip`
(ou `18d1:9302 Google` une fois initialisé).

### Python 3.9 avec pyenv

```bash
sudo apt install -y build-essential libssl-dev zlib1g-dev libbz2-dev libreadline-dev \
  libsqlite3-dev libffi-dev liblzma-dev tk-dev
curl https://pyenv.run | bash
# suivre les instructions affichées pour ajouter pyenv au ~/.bashrc, puis :
pyenv install 3.9.19
~/.pyenv/versions/3.9.19/bin/python -m venv .venv-vision
.venv-vision/bin/pip install -r vision/requirements.txt
```

> Si `pip` ne trouve pas de paquet `pycoral` pour votre système, l'autre solution
> fiable est de lancer `face_tracker.py` dans un conteneur Docker Debian 10 (Python 3.7),
> comme expliqué par Jeff Geerling.

### Modèle de détection de visage

```bash
mkdir -p models
wget -P models https://raw.githubusercontent.com/google-coral/test_data/master/ssd_mobilenet_v2_face_quant_postprocess_edgetpu.tflite
```

### Lancer

```bash
cd vision
../.venv-vision/bin/python face_tracker.py --config ../config.json --dry-run -v   # test sans bouger la tête
../.venv-vision/bin/python face_tracker.py --config ../config.json
```

### Réglages (`config.json` → `vision`)

| Clé | Effet |
|---|---|
| `pan.invert` / `tilt.invert` | La tête part dans le mauvais sens ? Passez à `true` / `false`. |
| `gain` | Vitesse de réaction. Trop grand = la tête oscille ; trop petit = elle traîne. |
| `deadband` | Zone morte au centre de l'image (0.08 = 8 %), pour éviter les tremblements. |
| `max_step` | Nombre maximum de degrés par commande (protège les servos). |
| `min` / `max` | **Mettez les mêmes limites que dans MyRobotLab** pour ne jamais forcer la mécanique. |
| `show_window` | `true` pour voir l'image et les visages détectés (écran nécessaire). |

## 3. Reconnaissance vocale améliorée

Améliorations par rapport à la reconnaissance d'origine :

1. **Whisper (faster-whisper) hors ligne** : bien meilleur en français, pas besoin d'Internet.
2. **Détection de voix (WebRTC VAD)** : Whisper n'est appelé que quand quelqu'un parle,
   ce qui économise le processeur et évite les phrases inventées sur le bruit des servos.
3. **Filtres anti-erreurs** : on ignore les segments à faible confiance et les « hallucinations »
   connues de Whisper en français (« Sous-titres réalisés par la communauté d'Amara.org »...).
4. **Mot de réveil tolérant** : « InMoov », « In Moov », « Inmove » sont tous acceptés.
   Dire juste « InMoov » → le robot répond « oui ? » et écoute la phrase suivante.
5. **Vocabulaire** (`vocabulary`) : les mots donnés aident Whisper à bien écrire les noms propres.
6. **Commandes locales** instantanées (`commands`), avec tolérance aux petites erreurs ;
   tout le reste part au chatbot d'InMoov2.
7. **Le micro est ignoré pendant que le robot parle** (durée estimée d'après la longueur de la réponse).

### Installation

```bash
sudo apt install -y libportaudio2
python3 -m venv .venv-voice
.venv-voice/bin/pip install -r voice/requirements.txt
cd voice
../.venv-voice/bin/python speech_listener.py --list-devices      # trouver le numéro du micro
../.venv-voice/bin/python speech_listener.py --config ../config.json --dry-run
```

Au premier lancement, le modèle Whisper est téléchargé (environ 150 Mo pour `base`).

### Choix du modèle Whisper (`whisper_model`)

| Modèle | Français | Vitesse sur Pi 5 |
|---|---|---|
| `tiny` | moyen | le plus rapide (≈ 2-3 s pour 10 s d'audio) |
| `base` | **bon compromis (par défaut)** | rapide |
| `small` | très bon | plus lent, à tester selon votre patience |

Les phrases adressées au robot sont courtes (2 à 4 s), donc le temps de réponse
est bien plus court que pour 10 s d'audio.

### Le matériel compte autant que le logiciel

- Un **micro USB de conférence** ou un **ReSpeaker USB Mic Array** (avec réduction de bruit)
  donne de bien meilleurs résultats qu'une webcam ou un micro jack.
- Placez le micro **loin des servos et du ventilateur** du Pi, idéalement dans la tête, orienté vers l'avant.
- Trop de fausses détections ? Montez `vad_aggressiveness` à 3.
  Le robot ne vous entend pas ? Descendez-le à 1.

## 4. IA conversationnelle (Claude) à la place du chatbot d'InMoov2

Quand `brain.enabled` vaut `true` dans `config.json`, les phrases qui ne sont pas des
commandes locales partent vers **Claude** (API Anthropic) au lieu du chatbot AIML :

- réponses naturelles en français, courtes et adaptées à la synthèse vocale ;
- **mémoire de la conversation** (remise à zéro après 10 min de silence, `reset_after_idle_s`) ;
- Claude peut **tourner la tête, ouvrir/fermer les mains, revenir au repos** (outils `move_head`,
  `hand`, `rest_position`), toujours dans les limites de `config.json` ;
- **les jambes ne sont pas accessibles à l'IA**, volontairement ;
- si Internet ou l'API ne répond pas, le robot **repasse automatiquement sur le chatbot d'InMoov2** ;
- si Claude refuse une demande, l'API la relance sur le modèle de secours recommandé
  (option `fallbacks: "default"`), sinon le robot dit poliment qu'il ne répond pas.

### Mise en route

1. Créer une clé API sur <https://platform.claude.com> (l'usage est payant, au nombre de mots traités).
2. Sur le Pi :
   ```bash
   echo 'ANTHROPIC_API_KEY=sk-ant-...' > /home/pi/inmoov/anthropic.env
   chmod 600 /home/pi/inmoov/anthropic.env      # ce fichier ne doit jamais aller sur GitHub
   ```
3. Dans `config.json` → `brain` : mettre votre prénom dans `owner_name`, le nom du robot dans
   `robot_name`, et éventuellement des consignes dans `extra_instructions`
   (« Tu tutoies tout le monde », « Tu adores l'astronomie »...).
4. Test sans bouger le robot : `../.venv-voice/bin/python speech_listener.py --config ../config.json --dry-run`
   (avec la clé chargée : `set -a; . ../anthropic.env; set +a`).

| Clé `brain` | Effet |
|---|---|
| `model` | `claude-opus-5-5` par défaut |
| `effort` | `low` = réponses plus rapides et moins chères (bien pour la conversation) ; `medium`/`high` = plus réfléchi mais plus lent |
| `max_tool_rounds` | nombre maximum de gestes enchaînés pour une même phrase |
| `*_service`, `*_min`, `*_max` | noms des services MyRobotLab et limites des mouvements autorisés à l'IA |

## 5. Démarrage automatique

```bash
sudo cp systemd/inmoov-*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now inmoov-vision inmoov-voice
journalctl -u inmoov-voice -f      # voir ce que le robot entend
```

## 6. Tests (sans matériel)

```bash
python3 -m unittest discover -s tests -v
```

Ces tests vérifient la logique de suivi, le découpage audio, le mot de réveil, les commandes,
le format des appels à MyRobotLab (avec un faux serveur), le cerveau Claude (avec un faux client,
si le paquet `anthropic` est installé), les poses des jambes, la cohérence des limites
entre le Pi et le firmware Arduino, et le calcul de couple.
Ils **ne remplacent pas** un essai réel avec le Coral, la caméra et le micro.

## 7. Jambes motorisées

> ⚠️ **Sécurité d'abord.** Un robot de cette taille qui tombe se casse et peut blesser.
> Tous les essais se font **robot accroché à un portique** (sangle au niveau du bassin),
> avec un **arrêt d'urgence matériel qui coupe l'alimentation des servos**.
> Le firmware ajoute des protections, il ne remplace pas ces deux-là.

Les jambes publiées par Gaël Langevin sont prévues pour tenir debout ; il n'existe pas de
version motorisée officielle. Ce dossier fournit une base pour **12 articulations**
(6 par jambe : hanche lacet / roulis / tangage, genou, cheville tangage / roulis).

### 7.1 Choisir les moteurs : d'abord peser le robot

```bash
cd legs
python3 torque_calc.py --masse 18                 # remplacez 18 par la masse réelle portée par les jambes
python3 torque_calc.py --masse 18 --reduction 4   # avec une réduction 4:1 (poulies/engrenages)
```

Exemple **pour 18 kg** (valeur d'exemple, pas la masse de votre robot), coefficient de sécurité 1,5 :

| Articulation | Couple sans réduction | Avec réduction 4:1 |
|---|---|---|
| Genou (accroupi 40°, 2 pieds) | 176 kg·cm | 44 kg·cm |
| Hanche roulis / cheville roulis (sur 1 pied) | 243 kg·cm | 61 kg·cm |
| Cheville tangage (sur 1 pied) | 135 kg·cm | 34 kg·cm |
| Hanche tangage | 68 kg·cm | 17 kg·cm |
| Hanche lacet | 24 kg·cm | 6 kg·cm |

Actionneurs comparés (couple continu retenu ≈ 1/3 du couple de blocage quand le fabricant
ne donne pas de couple nominal) :

| Actionneur | Couple | Bus | Compatible avec le firmware fourni |
|---|---|---|---|
| Feetech STS3215 12 V | 30 kg·cm blocage | TTL 1 Mbit/s | oui |
| Feetech STS3250 12 V | 50 kg·cm blocage, 16 nominal | TTL 1 Mbit/s | oui |
| RSBL85-12 (Waveshare/Feetech) | 85 kg·cm | à vérifier avant achat | à vérifier |
| Feetech SM-1500 12 V | 180 kg·cm blocage | RS485, 115200 bauds | même protocole, mais adaptateur RS485 et `BUS_BAUD` à changer |
| MyActuator RMD-X8 Pro | 8 N·m nominal (≈ 82 kg·cm), 48 V | CAN | non (firmware à adapter) |

**Conclusion honnête :** sans réduction, **aucun servo « bus » de cette liste ne tient le robot
sur une jambe** dès qu'il pèse une quinzaine de kilos. Pistes réalistes :

1. **Commencer par les mouvements à deux pieds** (flexions, balancement léger), où les couples sont
   bien plus faibles ;
2. ajouter une **réduction 3:1 à 5:1** (poulies crantées GT2/HTD) sur genoux, hanches et chevilles ;
3. utiliser des **SM-1500** (ou plus gros) pour genoux, chevilles et roulis de hanche, et des
   **STS3250** pour les lacets de hanche ;
4. **alléger le haut du corps** (remplissage d'impression réduit, batteries dans le bassin) ;
5. la **marche** ne viendra qu'ensuite, avec le portique, très lentement.

### 7.2 Câblage

```
Raspberry Pi 5 ──USB──► Arduino Mega 2560
                         ├─ Serial1 (TX1 18 / RX1 19) ─► adaptateur bus Feetech (half-duplex) ─► servos 1-6, 11-16
                         ├─ I2C (SDA 20 / SCL 21) ──────► BNO085 (centrale inertielle) dans le bassin
                         └─ broche 2 ◄── bouton d'arrêt d'urgence (contact NF vers GND)
Alimentation servos 12 V forte puissance ─► via le contact de l'arrêt d'urgence ─► servos
Masse commune Arduino / adaptateur / alimentation servos
```

Numérotation : jambe gauche ID 1 à 6, jambe droite ID 11 à 16, dans l'ordre
hanche lacet, hanche roulis, hanche tangage, genou, cheville tangage, cheville roulis.
Programmez l'ID de chaque servo **un par un** (logiciel FD de Feetech) avant de les chaîner.

### 7.3 Firmware Arduino (`legs/firmware/inmoov_legs/`)

Bibliothèques à installer : **SCServo** et **Adafruit BNO08x**. Carte : *Arduino Mega 2560*.
Le firmware a été compilé pour la Mega (30 Ko de flash, 4 Ko de RAM) ; il n'a pas encore tourné
sur de vrais servos.

Protections intégrées : limites de position par articulation, arrêt si un servo ne répond plus,
dépasse **65 °C** ou reste en **surcharge** ; arrêt si le bassin penche de plus de **20°** ;
arrêt si le Pi n'envoie plus de battement de cœur pendant 1 s ; bouton d'arrêt d'urgence.
En défaut, les articulations sont **figées** (pas de coupure du couple, sinon le robot s'effondre)
et tout mouvement est refusé jusqu'à la commande `RESET`. **Au démarrage, le firmware est en défaut.**

### 7.4 Calibration puis premiers mouvements

1. Jambes tendues, robot sur le portique : calibrer le milieu de chaque servo (position 2048)
   avec le logiciel FD de Feetech.
2. Resserrer `POS_MIN` / `POS_MAX` dans le firmware selon votre mécanique.
3. Côté Pi :
   ```bash
   python3 -m venv .venv-legs && .venv-legs/bin/pip install -r legs/requirements.txt
   cd legs
   cp legs_config.example.json legs_config.json
   ../.venv-legs/bin/python legs_controller.py --config legs_config.json check     # vérifie les poses
   ../.venv-legs/bin/python legs_controller.py --config legs_config.json status
   ../.venv-legs/bin/python legs_controller.py --config legs_config.json reset
   ../.venv-legs/bin/python legs_controller.py --config legs_config.json pose test_genoux_5deg
   ```
4. **Vérifier le sens de chaque articulation** avec de petits angles. Si une articulation part à
   l'envers, mettre sa `direction` à `-1` dans `legs_config.json`.
5. Seulement ensuite : `pose flexion_legere`, puis `sequence flexions` et `sequence balancement`.

Les poses sont en degrés (0 = debout). Une pose hors limites est **refusée**, pas rabotée.
