# Kamil dans Home Assistant (MQTT)

Kamil reste sur le Raspberry Pi (micro, caméras, moteurs). Par MQTT, Home Assistant le voit comme un
appareil **Kamil**, créé tout seul (découverte MQTT), avec ses entités. Kamil agit déjà sur la maison
par l'assistant Assist (section `brain.home_assistant`) ; MQTT ajoute le chemin inverse :
Home Assistant voit Kamil et peut le commander.

## Entités

| Entité (nom habituel)                     | Ce que c'est |
|-------------------------------------------|--------------|
| `sensor.kamil_etat`                       | en veille / réveillé / réfléchit / parle |
| `sensor.kamil_derniere_phrase_entendue`   | dernière phrase entendue par le micro |
| `sensor.kamil_derniere_reponse`           | dernière chose dite par Kamil |
| `sensor.kamil_voix_reconnue`              | qui a parlé (reconnaissance des voix) |
| `sensor.kamil_personnes_vues`             | nombre de personnes devant les caméras |
| `binary_sensor.kamil_mouvement`           | mouvement devant l'une des 2 caméras |
| `sensor.kamil_dernier_evenement`          | dernier événement du journal de surveillance |
| `switch.kamil_mode_garde`                 | mode garde (comme « surveille la maison ») |
| `camera.kamil_camera_1`, `camera.kamil_camera_2` | images des caméras (une toutes les 2 s) |
| `notify.kamil_dire`                       | Kamil dit le message à voix haute |
| `text.kamil_faire_dire`                   | idem, depuis un tableau de bord |
| `text.kamil_question`                     | question écrite : Kamil répond à voix haute |

Les noms exacts sont dans Paramètres → Appareils et services → MQTT → Kamil.
Si Kamil s'arrête, toutes ses entités passent à « indisponible ».

## Installation

1. **Home Assistant** : Paramètres → Modules complémentaires → Boutique → **Mosquitto broker** →
   Installer → Démarrer. Puis Paramètres → Appareils et services : l'intégration **MQTT** est
   proposée, la configurer.
2. **Un identifiant pour Kamil** : Paramètres → Personnes → Utilisateurs → Ajouter (ex. `kamil`,
   un mot de passe ; le mode avancé du profil doit être activé pour voir l'onglet Utilisateurs).
   Le module Mosquitto accepte les utilisateurs de Home Assistant.
3. **Sur le Pi** :
   ```bash
   ~/domokami/inmoov/.venv-voice/bin/pip install paho-mqtt
   ```
   puis ajouter à `anthropic.env` (jamais envoyé sur GitHub) :
   ```
   MQTT_USERNAME=kamil
   MQTT_PASSWORD=le-mot-de-passe
   ```
   et dans `config.json` :
   ```json
   "mqtt": { "enabled": true, "host": "192.168.1.252", "port": 1883 }
   ```
4. Relancer Kamil. Le journal affiche « Home Assistant (MQTT) : connecté, appareil « Kamil » annoncé ».

## Exemples d'automatisations

Faire parler Kamil :
```yaml
action: notify.send_message
target:
  entity_id: notify.kamil_dire
data:
  message: "Le linge est sec !"
```

Lui poser une question (il répond à voix haute, et peut lui-même agir sur la maison) :
```yaml
action: text.set_value
target:
  entity_id: text.kamil_question
data:
  value: "Quel temps fait-il dehors ?"
```

Activer le mode garde quand tout le monde part :
```yaml
action: switch.turn_on
target:
  entity_id: switch.kamil_mode_garde
```
