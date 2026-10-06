# InMoov : Raspberry Pi 5 + Coral USB

Deux programmes qui tournent **à côté de MyRobotLab (Nixie)** sur le Raspberry Pi 5
et lui parlent par son API REST (`http://127.0.0.1:8888/api/service/...`) :

| Programme | Rôle | Python |
|---|---|---|
| `vision/face_tracker.py` | Caméra USB → Coral USB → tourne `rothead` / `neck` vers le visage le plus proche | **3.9** (obligatoire pour PyCoral) |
| `voice/speech_listener.py` | Micro → détection de voix → Whisper → commandes locales ou chatbot `i01.chatBot` | 3.11 (celui du système) |

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

## 4. Démarrage automatique

```bash
sudo cp systemd/inmoov-*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now inmoov-vision inmoov-voice
journalctl -u inmoov-voice -f      # voir ce que le robot entend
```

## 5. Tests (sans matériel)

```bash
python3 -m unittest discover -s tests -v
```

Ces tests vérifient la logique de suivi, le découpage audio, le mot de réveil, les commandes
et le format des appels à MyRobotLab (avec un faux serveur).
Ils **ne remplacent pas** un essai réel avec le Coral, la caméra et le micro.

## 6. Jambes motorisées : feuille de route

Les jambes InMoov publiées par Gaël Langevin sont prévues pour **tenir debout** ; la version
motorisée n'a pas été finalisée (le problème annoncé est de trouver des moteurs bon marché,
assez puissants et rapides). Faire **marcher** un robot de cette taille est un projet
d'un autre niveau. Ordre conseillé :

1. **Bassin + hanches motorisées** (rotation du bassin, inclinaison) : le robot bouge
   le haut du corps sur ses jambes fixes.
2. **Genoux et chevilles motorisés, robot accroché à un portique** de sécurité : fléchir,
   se baisser, transférer le poids d'une jambe sur l'autre.
3. **Capteurs d'équilibre** : centrale inertielle (IMU, ex. BNO085) dans le bassin et capteurs
   de force sous les pieds, lus par le Pi 5.
4. **Marche assistée**, toujours avec le portique, à vitesse très lente.

Pour les articulations porteuses (hanches, genoux), les servos de modélisme classiques ne
suffisent pas : il faut regarder des **servos « bus » à fort couple avec retour de position**
ou des **moteurs brushless avec réducteur et contrôleur**. Le choix dépend du poids réel de
votre robot : **pesez le haut du corps** avant de choisir les moteurs.
