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

### Beacon et Cartographer installés en parallèle

Beacon Surface Scanner v2.0.0 et Cartographer Probe v1.2.5 cohabitent dans le
gestionnaire de mise à jour. Beacon ne cause aucune panne — un plugin Klipper ne
se charge que si une section de configuration le référence — mais garder les deux
n'apporte rien et brouille le diagnostic.
