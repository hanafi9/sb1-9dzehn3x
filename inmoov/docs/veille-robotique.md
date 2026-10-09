# Veille robotique : InMoov face à l'état de l'art (octobre 2026)

Objectif : repérer ce qui se fait de mieux en robotique humanoïde et en reprendre ce qui est
**réaliste pour un InMoov sur Raspberry Pi 5**, avec un budget de particulier.

## Ce que font les autres

| Domaine | État de l'art | Exemple vérifié |
|---|---|---|
| Apprentissage des gestes | On **montre** le geste (téléopération), le robot l'enregistre puis une IA apprend à le refaire | Hugging Face **LeRobot** : bibliothèque open source (apprentissage par imitation, renforcement, modèles vision-langage-action). La politique **ACT** (~80 M de paramètres) est conseillée aux débutants car rapide à entraîner ; bras **SO-101** pilotés par un bras « maître » |
| Cerveau « tout-en-un » | Modèles **VLA** (vision → langage → action) qui pilotent directement les moteurs | **GR00T N1** (NVIDIA, humanoïdes), **pi0 / pi0.5**, **SmolVLA** (petit, entraînable sur une seule carte graphique) ; LeRobot prend en charge Reachy 2 et Unitree G1 |
| Conversation et vision | Grands modèles multimodaux : le robot comprend ce qu'il voit et en parle | Claude, avec analyse d'image |
| IA sans Internet | Accélérateurs IA embarqués | **Raspberry Pi AI HAT+ 2** : Hailo-10H, 40 TOPS (INT4), 8 Go de mémoire, environ 200 $ ; fait tourner Qwen 2.5 1,5B ou Llama 3.2 1B via une interface compatible Ollama |
| Voix | Synthèse neuronale hors ligne | **Piper** (licence MIT), voix françaises tom, siwis, upmc, gilles |
| Toucher | Bouts de doigts sensibles : jauges de contrainte, micro de contact, capteurs optiques | Recherches HumanFT, Visiflex ; version économique : capteur de force sous un doigt souple en TPU |
| Moteurs | Moteurs brushless à réducteur avec mesure de courant, forts couples | **Unitree G1** : 1,20 m, ~35 kg, 23 articulations, jusqu'à 120 N·m (genou 90 N·m), batterie 9 Ah pour environ 2 h, caméra de profondeur + LiDAR |
| Sécurité | Chaque moteur mesure son courant et se coupe en cas de blocage | Standard sur les robots commerciaux |

## Comparaison avec InMoov

| Fonction | InMoov d'origine | Ajouté dans l'Atelier | Prochaine étape possible |
|---|---|---|---|
| Apprendre un geste | Scripts écrits à la main | **Mode imitation** : le robot copie vos bras et vos doigts (MediaPipe) et **enregistre le geste** pour le rejouer | Enregistrer aussi les images et entraîner une politique **ACT avec LeRobot** sur un PC avec carte graphique |
| Conversation | Chatbot AIML à règles | **Claude** + mémoire des personnes + gestes déclenchés par l'IA | Agent qui enchaîne des tâches |
| Vision | Suivi de visage | Suivi de visage sur **Coral** + **« qu'est-ce que tu vois ? »** (image envoyée à Claude) | Caméra de profondeur (OAK-D, RealSense) pour saisir des objets |
| Sans Internet | Rien | **IA locale de secours** (Ollama ou AI HAT+ 2) + **voix Piper** + reconnaissance Whisper | Tout en local avec l'AI HAT+ 2 |
| Toucher | Aucun | **Capteurs de force au bout des doigts** + **prise douce** (chaque doigt s'arrête au contact) | Doigts souples en TPU avec capteur intégré |
| Sécurité électrique | Aucune mesure | **Courant de chaque carte mesuré**, coupure automatique en cas de blocage, batterie surveillée | Servos « bus » avec retour de couple pour les bras |
| Électronique | 2 Arduino, un fil par servo | **1 Arduino + 3 cartes PCA9685**, schémas générés | Servos bus chaînés (comme les jambes) |
| Jambes | Statiques | Firmware + calcul de couple + sécurités | Moteurs brushless à réducteur, puis équilibre avec la centrale inertielle |
| Autonomie | Câble secteur | Batterie LiFePO4 surveillée (schéma Capteurs) | — |

## Ce qu'on n'a pas repris (pour l'instant), et pourquoi

- **Modèles VLA pilotant directement les moteurs** : il faut des centaines de démonstrations
  enregistrées et une carte graphique pour l'entraînement. Le mode imitation est la première
  marche : il apprend à enregistrer des démonstrations.
- **Marche autonome** : les robots qui marchent utilisent des moteurs de 90 à 120 N·m et
  du contrôle d'équilibre avancé. Pour InMoov, la priorité reste le portique et les mouvements
  à deux pieds (voir le calcul de couple).

## Sources

- LeRobot (article) : https://arxiv.org/pdf/2602.22818 · dépôt : https://github.com/huggingface/lerobot
- SmolVLA : https://arxiv.org/pdf/2506.01844 · GR00T N1 : https://arxiv.org/abs/2503.14734
- NVIDIA et Hugging Face (LeRobot, Reachy 2) : https://blogs.nvidia.com/blog/hugging-face-lerobot-models-frameworks-open-robotics/
- Imitation SO-101 avec ACT : https://huggingface.co/docs/lerobot/il_robots
- Raspberry Pi AI HAT+ 2 : https://www.raspberrypi.com/products/ai-hat-plus-2/ · modèles : https://www.hardware-corner.net/local-llms-raspberry-pi-ai-hat-plus-2/
- Piper, voix : https://github.com/rhasspy/piper/blob/master/VOICES.md
- Doigts tactiles : https://arxiv.org/abs/2410.10353 (HumanFT), https://arxiv.org/html/2510.05382v1
- Unitree G1 : https://robotsguide.com/robots/unitree-g1
