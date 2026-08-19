# Dépannage — VCore 3.1 · RatOS v2.1.0-RC2 · EBB42 + U2C + Cartographer

Journal des pannes résolues sur cette machine, avec la cause exacte et le correctif.
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
