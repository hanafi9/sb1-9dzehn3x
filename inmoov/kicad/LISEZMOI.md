# Projet KiCad : schémas électriques du robot InMoov

Ouvrir `inmoov-electrique.kicad_pro` avec **KiCad 7, 8 ou 9** (gratuit : https://www.kicad.org).
KiCad 8 et 9 proposent de mettre le fichier à jour vers leur format : acceptez.

- La feuille racine montre les 8 sections. Double-cliquez sur une case pour l'ouvrir :
  alimentation, tête, cou, torse, bras, mains, bassin, jambes.
- Les masses (`GND`) et les rails (`+6V_A`, `+3V3_PI`, `+5V_MEGA1`…) sont reliés d'une feuille
  à l'autre par des étiquettes globales.
- Les cases notées `X…` sont des rappels d'un élément dessiné sur une autre feuille
  (hors nomenclature). Les composants `U…` sont les vrais composants.
- Ce sont des schémas de câblage (documentation du robot), pas un circuit imprimé.

Ces fichiers sont **générés** à partir des schémas de l'Atelier :

```bash
python3 app/kicad_export.py kicad
```

Une modification faite à la main dans KiCad sera écrasée à la prochaine génération : pour
changer le câblage, modifiez `app/electrical.py` (ou demandez-le), puis régénérez.
Le projet a été vérifié avec KiCad 7.0.11 : le netlist exporté par KiCad contient exactement
les connexions des schémas de l'Atelier (test `tests/test_kicad.py`).
