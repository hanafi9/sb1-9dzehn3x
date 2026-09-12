# Diagnostic de l'axe Z — reprise à zéro

Tout ce qui précède est écarté. Les conclusions antérieures reposaient sur des
tests dont le câblage a changé entre deux mesures : elles ne prouvent rien.

## Principe

Un seul moteur, un seul câble, un seul nom Klipper. **Seul le slot change.**

Les trois moteurs Z sont réduits à un seul dans la configuration : `stepper_z`.
`stepper_z1`, `stepper_z2` et `z_tilt` sont désactivés le temps du diagnostic.
Il devient alors impossible de confondre deux steppers, puisqu'il n'y en a
qu'un.

---

## Phase 0 — étiqueter, une fois pour toutes

Avant de toucher à quoi que ce soit, et sans jamais les retirer ensuite :

- un ruban sur chaque câble moteur, **côté carte** : `AG`, `AD`, `ARR`
  (avant-gauche, avant-droit, arrière — vus **de face**, devant la machine) ;
- un trait de feutre sur **l'arbre** de chaque moteur, visible sans démonter.

Le trait sur l'arbre sert à distinguer « le moteur ne tourne pas » de
« le moteur tourne et la vis ne suit pas » (accouplement desserré). Ce sont
deux pannes différentes qui se ressemblent quand on regarde le plateau.

---

## Phase 1 — un moteur, quatre slots

On garde **le moteur AG et son câble**, et rien d'autre. Les deux autres
moteurs restent débranchés pendant toute la phase.

### Configuration de diagnostic

Dans `printer.cfg`, commenter entièrement :

```
[stepper_z1]  [tmc2209 stepper_z1]
[stepper_z2]  [tmc2209 stepper_z2]
[z_tilt]
```

Ne reste que `[stepper_z]`, dont on remplace les quatre broches à chaque
essai. Le reste de la section (`microsteps`, `rotation_distance`,
`endstop_pin`, `position_*`) ne change jamais.

| Essai | step | dir | enable | uart |
|---|---|---|---|---|
| MOTOR2 | `PF11` | `PG3` | `!PG5` | `PC6` |
| MOTOR3 | `PG4` | `PC1` | `!PA0` | `PC7` |
| MOTOR4 | `PF9` | `PF10` | `!PG2` | `PF2` |
| MOTOR5 | `PC13` | `PF0` | `!PF1` | `PE4` |

Les `dir_pin` sont donnés **sans `!`** : le sens ne nous intéresse pas ici,
seulement le fait que ça tourne. On réglera les sens à la fin.

### Pour chaque essai

1. **Couper l'alimentation**, attendre l'extinction des LED.
2. Brancher la fiche du moteur AG sur le connecteur du slot testé.
3. Rallumer, éditer les quatre broches, `FIRMWARE_RESTART`.
4. ```
   DUMP_TMC STEPPER=stepper_z
   FORCE_MOVE STEPPER=stepper_z DISTANCE=5 VELOCITY=5
   DUMP_TMC STEPPER=stepper_z
   ```

### Ce qu'on note

| Slot | UART répond ? | `MSCNT` change ? | L'arbre tourne ? |
|---|---|---|---|
| MOTOR2 | | | |
| MOTOR3 | | | |
| MOTOR4 | | | |
| MOTOR5 | | | |

Lecture :

- **UART muet** → le driver ne communique pas : mauvais contact, jumpers du
  slot différents des autres, ou driver mort côté logique.
- **UART répond, `MSCNT` figé** → aucune impulsion de pas n'arrive : la
  broche `step` du slot ne commute pas.
- **`MSCNT` change, arbre immobile** → l'étage de puissance ne délivre rien :
  driver mort côté puissance, ou circuit ouvert.
- **Arbre tourne** → le slot est bon.

---

## Phase 2 — seulement si un slot échoue

Un slot en échec accuse deux choses à la fois : le slot *et* le driver qui s'y
trouve. Pour les séparer, **alimentation coupée**, échanger le driver du slot
en échec avec celui d'un slot qui a réussi, et refaire l'essai des deux.

- la panne suit le driver → **driver**
- la panne reste au slot → **carte**

⚠️ Jamais d'extraction ni d'insertion de driver sous tension, ni tant que les
LED de la carte sont allumées. C'est le moyen le plus courant de détruire des
drivers en série — et une panne qui se déplace de slot en slot au fil des
manipulations en est la signature.

---

## Phase 3 — seulement une fois les slots connus

Répéter la phase 1 sur **un seul slot déclaré bon**, en changeant cette fois
de moteur : AG, puis AD, puis ARR, avec leurs câbles respectifs. Une seule
variable là encore — le moteur.

---

## Phase 4 — remontage définitif

Adopter la convention de RatOS, pour que `z_positions` se recopie sans
réordonner et qu'il n'y ait plus jamais d'ambiguïté de nom :

| Nom Klipper | Vis, vue de face | Position `z_tilt` |
|---|---|---|
| `stepper_z`  | **avant-gauche** | `0,0` |
| `stepper_z1` | **arrière**      | `200,400` |
| `stepper_z2` | **avant-droite** | `400,0` |

Brancher les câbles étiquetés `AG`, `ARR`, `AD` dans cet ordre sur les trois
slots retenus, puis rétablir `[stepper_z1]`, `[stepper_z2]` et `[z_tilt]`.

Régler les sens en dernier : `FORCE_MOVE … DISTANCE=5` doit faire **descendre**
le plateau. Chaque vis qui monte reçoit un `!` sur son `dir_pin`.

Mise à plat manuelle des trois vis avant le premier `Z_TILT_ADJUST`.
