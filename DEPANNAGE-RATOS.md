# Dépannage — VCore 3.1 · RatOS v2.1.0-RC2 · EBB42 + U2C + Cartographer

Journal des pannes résolues sur cette machine, avec la cause exacte et le correctif.
Les actions physiques encore en attente sont réunies dans « À faire sur la machine ».
À relire après toute mise à jour de Klipper ou du plugin Cartographer : les patchs
appliqués à des dépôts tiers sont écrasés par `git pull`.

## Matériel

| Rôle | Carte | MCU | Liaison | UUID |
|---|---|---|---|---|
| Carte mère | BTT Octopus Pro | STM32F446 | USB série | — |
| Pont CAN | BTT U2C v2.1 | STM32G0B1 | USB → `can0` | `6092d36469e1` |
| Toolboard | BTT EBB42 v1.1 | STM32G0B1 | CAN | `564fed93e397` |
| Sonde Z | Cartographer | STM32F042 | CAN | `4973681e12df` |

Bus CAN à 1 000 000 bps sur `can0`.

---

## À faire sur la machine

Actions physiques restantes, dans l'ordre où elles se tiennent. L'analyse de
chacune est plus bas — ici, seulement le geste et la commande.

### 1. Appliquer le Z-offset du Cartographer — bloquant pour la 1ʳᵉ couche

`machine/SAVE_CONFIG-backup-2026-09-03.cfg` porte `model_offset = 0.00000` :
le modèle de la sonde est calibré, son décalage à la buse ne l'est pas. Tant
qu'il vaut 0, la hauteur de première couche dépend entièrement du babystep,
et repart de zéro à chaque impression.

Sur une première couche, plateau et buse à température, ajuster au babystep
jusqu'à l'écrasement voulu, puis figer la valeur :

```
Z_OFFSET_APPLY_PROBE
SAVE_CONFIG
```

Klipper redémarre et `model_offset` prend sa valeur réelle (de l'ordre de
-0,05). Vérifier qu'elle n'est plus à 0 dans le bloc SAVE_CONFIG, et
resauvegarder ce bloc dans `machine/`.

### 2. Vérifier À L'ŒIL que les ventilateurs tournent — avant toute impression

Un ventilateur déclaré dans `printer.cfg` mais mort, débranché ou mal câblé ne
lève AUCUNE alarme dans Klipper. Deux l'ont déjà prouvé sur cette machine :

- **Ventilateur de heatbreak (avant de la Rapido).** Doit tourner dès que la
  buse dépasse 50 °C. Muet = heat creep, l'extrudeur grignote au bout d'une
  minute (panne 8, résolue).
- **Ventilateur de carte (CNC FAN2 / `PD12`).** Doit tourner dès qu'un moteur
  est sous tension. `[controller_fan board_fan]` est écrit dans `printer.cfg`,
  mais avec `run_current: 1.2` sur X et Y — le plafond continu d'un TMC2209 —
  un ventilateur muet est une panne thermique en attente (voir « Bruit sur les
  cinq moteurs »).

### 3. Vérifier le capteur de filament SFS

`QUERY_FILAMENT_SENSOR SENSOR=SFS` à l'arrêt ne prouve rien : `SFS` est un
`[filament_motion_sensor]`, une roue codeuse dont le contact bascule pendant
le mouvement et se fige au hasard à l'arrêt. Le test est la bascule, à froid,
filament engagé :

```
SET_FILAMENT_SENSOR SENSOR=SFS ENABLE=0
QUERY_FILAMENT_SENSOR SENSOR=SFS
```

pousser le filament de 2-3 cm à la main, puis reposer la question. L'état doit
changer. S'il reste figé : capteur sur le port `SENSOR` de l'Octopus
(VS/GND/PB7) et non Z-STOP, puis inverser la logique du pin `^PB7` → `^!PB7`
et `FIRMWARE_RESTART`. Rallumer ensuite avec `SFS_ENABLE`.

### 4. Reflasher les microcontrôleurs

Hôte en `v0.13.0-733`, Octopus en `v0.12.0-268`, EBB42 en `v0.12.0-208`. La
machine tourne, mais l'écart produira un `MCU Protocol error` dès qu'une
commande absente de la v0.12 sera émise. Octopus en USB, EBB42 via Katapult
sur CAN. Voir « Firmware des MCU en retard d'une version majeure ».

### 5. Trancher Cartographer / Beacon

Les deux plugins sont installés en parallèle et les correctifs 1 et 2 sont
écrasés à chaque mise à jour de `~/cartographer-klipper/`. Trois issues
durables, détaillées dans « Patchs du plugin Cartographer non pérennes » —
la décision n'a pas été prise.

---

## Panne 8 — l'extrudeur grignote après ~1 min d'impression (RÉSOLUE)

**Symptôme.** L'extrusion démarre bien, puis au bout d'une minute environ
l'Orbiter 2.0 se met à claquer / sauter et plus rien ne sort. Uniquement en
cours d'impression ; l'extrusion à vide sur une courte purge passait.

**Fausses pistes écartées.** Le moteur claque, donc il pousse contre une
résistance et garde son couple — ce n'est pas une coupure thermique du driver
(qui rendrait le moteur mou et silencieux). Le `model_offset` du Cartographer à
0 (première couche trop basse, cf. « À faire sur la machine ») était un suspect
plausible mais faux : le problème apparaissait aussi loin de la première couche.

**Cause. Heat creep.** Le ventilateur avant de la Rapido — le ventilateur de
*heatbreak*, qui refroidit la gorge, à ne pas confondre avec le ventilateur de
pièce — ne tournait pas. La chaleur remonte alors dans la gorge, le filament y
ramollit, gonfle et se coince. Le délai d'une minute est le temps que met la
chaleur à remonter ; l'extrusion à vide passait parce que le heat creep n'a pas
le temps de s'installer sur une courte purge.

**Correctif.** Rétablir le ventilateur de heatbreak. Dans `printer.cfg` il est
déclaré et démarre dès 50 °C :

```
[heater_fan hotend_fan]
pin: toolhead:PA1
heater: extruder
heater_temp: 50.0
```

La section était donc correcte : la panne était matérielle (ventilateur mort,
débranché, ou branché sur le mauvais connecteur de l'EBB42). Vérifier à l'œil
que ce ventilateur tourne dès que la buse dépasse 50 °C avant toute impression
longue — un `[heater_fan]` qui ne tourne pas ne lève aucune alarme dans Klipper.

---

## Panne 1 — `Can't register 'probe' as it is an invalid name`

**Cause.** Bug du plugin Cartographer, pas de la configuration.

`cartographer.py` et `idm.py` enregistrent une commande G-code en minuscules :

```python
self.gcode.register_command("probe", self.cmd_PROBE, ...)
```

`klippy/gcode.py::register_command` rejette tout nom non majuscule :

```python
if (cmd.upper() != cmd or not cmd.replace('_', 'A').isalnum()
    or cmd[0].isdigit() or cmd[1:2].isdigit()):
    raise self.printer.config_error(
        "Can't register '%s' as it is an invalid name" % (cmd,))
```

Toutes les autres commandes du plugin respectent la règle — seule celle-ci porte
la coquille. Elle est passée inaperçue jusqu'à ce que Klipper durcisse sa validation.

**Correctif.**

```bash
sed -i 's/register_command("probe"/register_command("PROBE"/' \
  ~/cartographer-klipper/cartographer.py ~/cartographer-klipper/idm.py
```

---

## Panne 2 — `Internal error during connect: 'MCU' object has no attribute '_mcu_freq'`

**Cause.** Le plugin lit un attribut privé de la classe `MCU` de Klipper :

```python
def _handle_mcu_identify(self):
    constants = self._mcu.get_constants()
    if self._mcu._mcu_freq < 20000000:
```

Klipper a déplacé `_mcu_freq` de `MCU` vers `MCUConfigHelper`. L'accès public
est `get_constant_float('CLOCK_FREQ')`.

**Correctif.**

```bash
sed -i "s/self\._mcu\._mcu_freq/self._mcu.get_constant_float('CLOCK_FREQ')/g" \
  ~/cartographer-klipper/cartographer.py ~/cartographer-klipper/idm.py
```

Le plugin accède aussi à `self._mcu._clocksync`, autre attribut privé — panne
potentielle au prochain refactor de Klipper.

---

## Panne 3 — `mcu 'toolhead': Unknown command: tmcuart_send`

**Cause.** Les deux `canbus_uuid` étaient permutés dans `printer.cfg`.
Klipper demandait à la carte « toolhead » de piloter le TMC2209 de l'extrudeur,
alors que cette carte était le Cartographer — qui n'a aucun driver de moteur.

Le rapport de version de Klipper trahissait la permutation :

```
toolhead:     CARTOGRAPHER 2.2.0        ← firmware Cartographer
cartographer: v0.12.0-208-g49c0ad636    ← firmware Klipper
```

Un EBB42 ne peut pas rapporter `CARTOGRAPHER`. Confirmé ensuite par les
identifiants de puces : `mcu toolhead = stm32g0b1xx` (EBB42),
`mcu cartographer = stm32f042x6`.

**Correctif.**

```ini
[mcu toolhead]
canbus_uuid: 564fed93e397

[cartographer]
canbus_uuid: 4973681e12df
```

⚠️ Toujours corriger la permutation **avant** tout flash CAN : le flash cible
une carte par son UUID. Avec des UUID inversés, le firmware EBB42 partirait
dans le Cartographer.

---

## Panne 6 — `Z_TILT_ADJUST` → `get_offsets() takes 1 positional argument but 2 were given`

**Cause.** Troisième incompatibilité de signature entre le plugin Cartographer
et Klipper, de la même famille que les pannes 1 et 2.

Le `probe.py` de Klipper appelle désormais la sonde avec un argument :

```python
# klipper/klippy/extras/probe.py:494
self.probe_offsets = probe.get_offsets(gcmd)
```

Mais `cartographer.py` définit la méthode sans l'accepter :

```python
def get_offsets(self):
```

D'où `TypeError: get_offsets() takes 1 positional argument but 2 were given`.
La panne ne se déclenche qu'au premier `Z_TILT_ADJUST` (ou toute opération
multi-points), seul chemin qui appelle `get_offsets` — inatteignable tant que
la sonde n'a pas de modèle calibré.

À noter : `scanner.py` du même dépôt a déjà la signature corrigée
(`get_offsets(self, gcmd=None)`), mais la config charge `[cartographer]`, donc
`cartographer.py`, resté en retard.

**Correctif.**

```bash
sed -i 's/def get_offsets(self):/def get_offsets(self, gcmd=None):/' \
  ~/cartographer-klipper/cartographer.py
```

Ajouter `gcmd=None` est sans risque : la méthode n'utilise pas l'argument,
elle l'absorbe seulement. Les deux occurrences du fichier (lignes 240 et 1279)
sont corrigées d'un coup. `idm.py` porte le même défaut mais n'est pas chargé.

---

## Panne 7 — `AttributeError: 'list' object has no attribute 'bed_z'` (migration scanner.py)

**Cause.** `cartographer.py` est en retard sur l'API sonde de Klipper. Le
Klipper récent (v0.13, `homing.py` **standard**, vérifié `git status` propre)
utilise l'API « probe session » : `probe_session.pull_probed_results()`
renvoie des objets avec un attribut `.bed_z`. L'ancien `cartographer.py`
renvoie des listes `[x, y, z]` — d'où le plantage à la première mesure Z d'un
`G28 Z` ou `Z_TILT_ADJUST`.

Ce n'est pas une coquille : toute l'interface de résultats a changé. La panne 6
(`get_offsets`) était le premier symptôme, celle-ci le second ; patcher fonction
par fonction reviendrait à réécrire à la main le module maintenu.

**Ce module maintenu existe déjà** dans le dépôt : `scanner.py`. Il implémente
la nouvelle API (`.bed_z`, ligne ~1305), enregistre `PROBE` en majuscules
(pas de panne 1) et a déjà `get_offsets(self, gcmd=None)` (pas de panne 6).
`cartographer.py` est l'ancien module, gardé pour les Klipper plus anciens
(comme celui qui fait tourner la config de l'ami de référence).

**Correctif — migrer de `[cartographer]` vers `[scanner]`.** Gabarit officiel :
`cartographer-klipper/scripts/setup.py`.

Remplacer toute la section `[cartographer]` par :

```ini
[mcu scanner]
canbus_uuid: 4973681e12df

[scanner]
mcu: scanner
x_offset: 0
y_offset: 21.1
backlash_comp: 0.5
sensor: cartographer
sensor_alt: carto
mesh_runs: 2

[temperature_sensor Cartographer_MCU]
sensor_type: temperature_mcu
sensor_mcu: scanner
min_temp: 0
max_temp: 105
```

- `[stepper_z] endstop_pin: probe:z_virtual_endstop` reste valide : `scanner.py`
  enregistre la puce `probe` (scanner.py:309).
- Retirer le bloc `#*# [cartographer model default]` du bas : format propre à
  `cartographer.py`, non lu par `scanner`. Recalibration nécessaire.
- La commande de calibration reste `CARTOGRAPHER_CALIBRATE` (le module scanner
  l'enregistre — confirmé par son propre `cartographer_ci_test.cfg`).

Après migration : plus aucune incompatibilité de version — `scanner.py` est
écrit pour ce Klipper. Les pannes 1, 2 et 6 (patchs sur `cartographer.py`)
deviennent sans objet.

### Corollaire — le firmware de la sonde doit suivre

`scanner.py` envoie la commande MCU `cartographer_home` avec un paramètre
`trigger_method` que le firmware **CARTOGRAPHER 2.2.0** ne connaît pas :
`mcu 'scanner': Command format mismatch`. Il faut flasher la sonde en
**5.1.0** (dossier `firmware/v2-v3/survey/5.1.0/`, binaire
`Survey_Cartographer_CAN_1000000_8kib_offset.bin` pour CAN 1 Mbit, offset 8 kib).

Procédure de flash CAN (sonde STM32F042, UUID `4973681e12df`) :

```bash
sudo systemctl stop klipper
# La sonde a un node-id attribué par Klipper → canbus_query la voit plus.
# On la fait sauter en bootloader par une commande CIBLÉE sur son UUID :
~/klippy-env/bin/python ~/katapult/scripts/flashtool.py -i can0 -u 4973681e12df -r
~/klippy-env/bin/python ~/katapult/scripts/flashtool.py -i can0 -q   # doit lister l'UUID en "Katapult"
~/klippy-env/bin/python ~/katapult/scripts/flashtool.py -i can0 -u 4973681e12df \
  -f ~/cartographer-klipper/firmware/v2-v3/survey/5.1.0/Survey_Cartographer_CAN_1000000_8kib_offset.bin
sudo systemctl start klipper
```

⚠️ Piège de diagnostic rencontré : `canbus_query` renvoyait « 0 uuids » alors
que les trois MCU étaient visibles au dashboard. Ce n'est ni un problème de bus
ni de câble — une fois Klipper connecté, les cartes ont un node-id et ne
répondent plus à la requête de découverte (qui ne cherche que les nœuds non
attribués). La commande `-r` ciblée par UUID, elle, passe toujours.

L'UUID est écrit en dur → seule la sonde est flashée, jamais l'EBB42
(`564fed93e397`) sur le même bus.

---

## Panne 4 — `mcu 'u2c': Unable to connect`

**Cause.** Une section `[mcu u2c]` avait été ajoutée à `printer.cfg`.

Le U2C est un pont USB↔CAN : il fait apparaître l'interface réseau `can0` sous
Linux, rien de plus. RatOS ne définit d'ailleurs aucune carte U2C dans
`RatOS/boards/`. Le déclarer en `[mcu]` ajoute un nœud qui doit répondre au
démarrage, sans rien piloter — un point de panne gratuit.

**Correctif.** Commenter la section. `can0` continue de fonctionner à l'identique.

---

## Panne 5 — deux slots moteur morts sur une Octopus Pro neuve (RÉSOLUE)

**Constat final.** Sur une carte BTT Octopus Pro 446 sortie du carton, **deux
slots ne pilotent pas** :

- **MOTOR3** (`y1_*` : PG4/PC1/PA0, uart PC7) — l'UART répond, mais aucun
  courant n'atteint le moteur : arbre libre à la main, moteur non maintenu.
- **MOTOR5** (`z0_*` : PC13/PF0/PF1, uart PE4) — courant présent (moteur dur),
  mais aucune impulsion de pas ne le fait tourner.

MOTOR4 avait déjà été écarté plus tôt. Trois slots consécutifs défaillants sur
une carte neuve : défaut de fabrication, pas un hasard.

**Ce qui a prouvé que c'était la carte.** L'échange des deux câbles moteur
entre eux, alimentation coupée : la panne est restée sur le **connecteur**, pas
sur le moteur qui s'y branchait. Les trois moteurs, les trois câbles et les
trois drivers (tous neufs) sont sains — chacun a fonctionné dès qu'il était
relié à un bon slot.

**Correctif.** Déplacer les deux steppers vers les slots inutilisés MOTOR6 et
MOTOR7, avec leurs broches officielles :

```ini
[stepper_z1]              [stepper_z2]
step_pin: PE2             step_pin: PE6
dir_pin: PE3              dir_pin: PA14
enable_pin: !PD4          enable_pin: !PE0
[tmc2209 stepper_z1]      [tmc2209 stepper_z2]
uart_pin: PE1             uart_pin: PD3
```

Les trois vis tournent. `DUMP_TMC` répond sur les deux nouveaux slots
(`GSTAT: 0`, `IFCNT` incrémenté) et `FORCE_MOVE` entraîne chaque moteur.

**Méthode — leçon.** Le diagnostic a duré bien trop longtemps parce que le nom
« z1 » a désigné trois vis différentes au fil des re-câblages, et que des
conclusions ont été tirées de tests dont le montage avait changé entre-temps.
Ce qui a débloqué : réduire la config à UN stepper, étiqueter les câbles, et ne
changer qu'UNE variable par test. L'échange des câbles — le seul test qui
isolait le connecteur de tout le reste — aurait dû venir en premier.

**Note sécurité.** Une panne qui se déplace de slot en slot au fil des
manipulations est la signature de drivers extraits/insérés sous tension.
Toujours couper le 24 V et attendre l'extinction des LED avant de toucher un
driver.

---

## Panne 5 bis — historique du diagnostic z2 (archivé)

**Constat.** `FORCE_MOVE STEPPER=stepper_z DISTANCE=5 VELOCITY=5` et son
équivalent sur `stepper_z1` entraînent chacun leur vis. La même commande sur
`stepper_z2` ne produit rien : pas de mouvement, pas de bruit, pas d'erreur.

Les trois moteurs sont neufs et la carte Octopus Pro est neuve. Ça n'élimine
qu'une cause sur trois :

- un moteur neuf ne garantit pas son **câble** (sertissage, connecteur JST) ;
- un driver qui répond en **UART** ne garantit pas son étage de puissance —
  déjà vérifié sur l'ancienne carte, où `DUMP_TMC` passait avec un pont en H
  mort. Les deux circuits sont indépendants ;
- une carte neuve ne garantit pas un **slot** exempt de soudure froide.

**Chaîne de preuve invalidée.** Une première série de tests concluait à deux
pannes indépendantes (branche arrière + slot MOTOR4). Cette conclusion est
retirée : entre les deux séries, le mapping physique s'est inversé
(`stepper_z` est passé de avant-gauche à avant-droite, `stepper_z1`
l'inverse). Des câbles ont donc bougé sans être tracés, et le test
« moteur arrière sur MOTOR3 → rien » ne prouve plus rien.

**Protocole de reprise.** Un drapeau de scotch sur chacun des trois
accouplements d'abord : un accouplement desserré donne un moteur qui tourne et
une vis immobile, indiscernable d'une panne électrique tant qu'on regarde le
plateau au lieu de l'arbre.

Puis deux tests, un seul changement à la fois, résultats notés séparément :

| Test | Manipulation | Commande |
|---|---|---|
| A | moteur arrière **et son câble** sur MOTOR2 | `FORCE_MOVE STEPPER=stepper_z DISTANCE=5 VELOCITY=5` |
| B | moteur avant-droit **et son câble** sur MOTOR4 | `FORCE_MOVE STEPPER=stepper_z2 DISTANCE=5 VELOCITY=5` |

| A | B | Conclusion |
|---|---|---|
| rien | tourne | branche arrière (moteur ou câble) |
| tourne | rien | slot MOTOR4 de la carte |
| rien | rien | les deux, indépendamment |
| tourne | tourne | erreur de suivi antérieure — rien à réparer |

**Mesure d'arbitrage** si le test A échoue — au multimètre, câble débranché,
côté connecteur carte : chaque paire à 2–4 Ω, les deux paires isolées entre
elles. Refaire la mesure sur le connecteur du moteur pour séparer câble et
moteur. Cette mesure ne fait intervenir ni Klipper ni la carte.

**Contournement** si MOTOR4 est mort : déplacer `stepper_z2` sur MOTOR5, voir
`machine/z-axis.cfg`.

---

## Dette technique restante

### Firmware des MCU en retard d'une version majeure

```
Hôte Klipper : v0.13.0-733
Octopus      : v0.12.0-268
EBB42        : v0.12.0-208
```

RatOS met Klipper à jour côté hôte sans reflasher les microcontrôleurs.
La machine fonctionne, mais cet écart finira par produire un
`MCU Protocol error` dès qu'une commande absente de v0.12 sera émise.

À reflasher : Octopus en USB, EBB42 via Katapult sur CAN en
`CAN bus (on PB0/PB1)` à 1000000 bauds.

### Patchs du plugin Cartographer non pérennes

Les correctifs 1 et 2 modifient `~/cartographer-klipper/`, un dépôt git géré par
le gestionnaire de mise à jour de Moonraker. Un `update` les écrase et la panne
revient. Le gestionnaire affichera « modifié » au lieu de « à jour ».

Trois issues durables :

- **Signaler les deux incompatibilités au projet Cartographer.** La branche
  `master` (mars 2026) contient toujours les deux bugs.
- **Figer Klipper** en désactivant sa mise à jour automatique dans
  `moonraker.conf` — on garde Cartographer, on perd les mises à jour Klipper.
- **Passer à Beacon**, supporté nativement par RatOS (`RatOS/z-probe/beacon.cfg`)
  et déjà installé sur cette machine. Suppose un changement de matériel de sonde.

### La configuration est autonome, et a perdu les réglages de RatOS

`~/printer_data/config/RatOS/` n'existe pas et `printer.cfg` ne contient aucun
`[include]` : le fichier a été réécrit à la main. Il n'hérite donc de rien, et
tout ce que RatOS réglait doit y figurer explicitement.

La référence reste disponible sur la machine, dans
`~/printer_data/config/.RatOS_repo_backup/printers/v-core-3/`. Comparer avec
elle plutôt que deviner. Ce qui manquait, réuni dans `machine/z-axis.cfg` :

| Manque | Référence RatOS |
|---|---|
| `[z_tilt]` absent | `400.cfg` — positions mesurées sur le châssis |
| `max_z_accel: 300` | `speed-limits-basic.cfg` : 30 · `-performance.cfg` : 150 |
| `minimum_cruise_ratio` absent | fixé à 0.5 dans les deux profils |
| `position_min` absent sur Z | `steppers.cfg` : `-5`, requis par `z_tilt` |
| ventilateur CNC FAN2 non piloté | `[controller_fan]` sur `PD12` |
| trois `dir_pin` Z non inversés | `DISTANCE` positif fait monter le plateau |

### Bruit sur les cinq moteurs — accélérations hors spécification

Symptôme : les cinq moteurs (X, Y et les trois Z) émettent un grognement absent
avant la reconstruction de la machine.

Deux fausses pistes écartées en cours de route, toutes deux par comparaison
avec la source RatOS :

- **StealthChop / SpreadCycle.** `stealthchop_threshold: 0` semblait suspect,
  mais `tmc2209.cfg` livre `stealthchop_threshold: 1` sur les cinq axes —
  fonctionnellement le même réglage. Ce n'est pas la cause.
- **`microsteps: 64`.** RatOS utilise 64 sur tous les axes, Z compris. Correct.

La cause est dans `[printer]` : `max_z_accel: 300`, soit le double du profil
performance de RatOS et dix fois son profil prudent, sur un axe à vis qui
déplace tout le plateau. `max_accel: 10000` place par ailleurs la machine en
territoire performance, dont RatOS écrit en tête de fichier :

```
# DO NOT ENABLE THIS WITHOUT ACTIVELY COOLED STEPPER DRIVERS.
```

⚠️ Combinaison à risque relevée sur cette machine : profil d'accélération de
type performance, `run_current: 1.2` sur X et Y — le plafond continu d'un
TMC2209 avec shunts de 0,110 Ω — et ventilateur de carte non piloté. Le
`[controller_fan]` est à appliquer avant toute impression.

### Beacon et Cartographer installés en parallèle

Beacon Surface Scanner v2.0.0 et Cartographer Probe v1.2.5 cohabitent dans le
gestionnaire de mise à jour. Beacon ne cause aucune panne — un plugin Klipper ne
se charge que si une section de configuration le référence — mais garder les deux
n'apporte rien et brouille le diagnostic.
