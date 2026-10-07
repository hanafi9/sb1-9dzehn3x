"""Manuel complet du robot, affiché dans l'onglet Documentation de l'Atelier.

Chaque chapitre est une suite de « blocs » :
  ("p", texte)                    paragraphe
  ("h", titre)                    sous-titre
  ("steps", [étape, ...])         étapes numérotées
  ("check", [point, ...])         liste de vérification
  ("cmd", [commande, ...])        commandes à copier
  ("warn", texte)                 avertissement
  ("tip", texte)                  astuce
  ("table", [en-têtes], [[...]])  tableau
  ("links", [(titre, url), ...])  liens
  ("schema", clé_partie)          schéma de câblage (onglet Schémas)
  ("servos", clé_partie)          tableau des servos de la partie
  ("parts", clé_partie)           pièces imprimées et matériel
  ("overview",)                   schéma de l'électronique complète
  ("tab", onglet, texte)          bouton vers un onglet de l'Atelier

Les informations mécaniques détaillées (ordre exact d'assemblage pièce par pièce)
renvoient aux tutoriels officiels d'InMoov, qui ont des photos de chaque étape.
"""

OFFICIAL = {
    "stl": ("Galerie STL officielle (toutes les pièces)", "https://inmoov.fr/inmoov-stl-parts-viewer/"),
    "hardware": ("Carte du matériel et liste d'achats (BOM)", "https://inmoov.fr/default-hardware-map/"),
    "hand": ("Tutoriel main et avant-bras", "https://inmoov.fr/hand-and-forarm/"),
    "tendons": ("Tutoriel : passer et tendre les tendons", "https://inmoov.fr/lining-and-tighting-the-tendons/"),
    "bicep": ("Tutoriel biceps", "https://inmoov.fr/bicep/"),
    "shoulder": ("Tutoriel épaules et torse", "https://inmoov.fr/shoulder-and-torso/"),
    "neck": ("Tutoriel cou et mâchoire", "https://inmoov.fr/neck-and-jaw/"),
    "eyes": ("Tutoriel mécanisme des yeux", "https://inmoov.fr/eye-mechanism/"),
    "topstom": ("Tutoriel ventre haut", "https://inmoov.fr/top-stomach/"),
    "midstom": ("Tutoriel ventre milieu", "https://inmoov.fr/mid-stomach/"),
    "mrl_start": ("Démarrer MyRobotLab (inmoov.fr)", "https://inmoov.fr/how-to-start-myrobotlab/"),
    "nixie": ("InMoov2 dans Nixie (inmoov.fr)", "https://inmoov.fr/inmoov2-in-nixie/"),
    "mrl_defaults": ("Réglages par défaut des potentiomètres (myrobotlab.org)",
                     "https://myrobotlab.org/content/setting-your-inmoov-defaults"),
    "group": ("Groupe d'entraide InMoov (Google Groups)", "https://groups.google.com/g/inmoov"),
    "mrl": ("Site et forum MyRobotLab", "https://myrobotlab.org/"),
}


def L(*keys):
    return ("links", [OFFICIAL[k] for k in keys])


CALIBRATION = [
    "Onglet Servos, choisir la partie. Tout mettre au repos (bouton « Repos ») et vérifier qu'aucun servo ne force ni ne grogne.",
    "Bouger doucement le curseur vers une butée. Juste avant que la mécanique force, noter la valeur.",
    "Reculer de 3 à 5 degrés : c'est la limite à saisir (min ou max). Faire pareil de l'autre côté.",
    "Si le mouvement part à l'envers, cocher « inversé ».",
    "Cliquer « Enregistrer + appliquer », puis « Enregistrer la config MyRobotLab ».",
]

CHAPTERS = [
    # ------------------------------------------------------------------
    {
        "id": "start", "title": "Commencer ici", "blocks": [
            ("p", "Ce manuel rassemble tout ce qu'il faut pour terminer le robot : chaque partie du corps a son "
                  "chapitre avec le rôle, les pièces, le schéma de câblage, le montage pas à pas, les réglages, "
                  "les tests et les problèmes fréquents. Le bouton « Tout imprimer » en haut crée un PDF à garder "
                  "à côté de l'atelier."),
            ("h", "Comment est organisé le robot"),
            ("overview",),
            ("table", ["Élément", "Rôle"], [
                ["Raspberry Pi 5", "Le cerveau : MyRobotLab, l'Atelier, la vision, la voix, l'IA, les capteurs"],
                ["Arduino Mega (i01.left) + 3 cartes PCA9685", "Pilotent les 31 servos du haut du corps"],
                ["Arduino Mega n°2", "Pilote les 12 servos bus des jambes, avec les sécurités"],
                ["Coral USB + caméra", "Suivi de visage"],
                ["Micro + haut-parleurs", "Écoute (Whisper) et parole"],
                ["Capteurs I2C", "Courant, batterie, toucher, présence"],
            ]),
            ("h", "Dans quel ordre travailler"),
            ("steps", [
                "Préparer le Raspberry Pi et installer MyRobotLab (chapitre Logiciel).",
                "Câbler l'électronique du torse : Arduino, cartes PCA9685, alimentation (chapitre Électronique).",
                "Monter et régler la tête, puis les bras, puis les mains, partie par partie.",
                "Ajouter la vision, la voix et l'IA.",
                "Ajouter les capteurs.",
                "Les jambes en dernier, toujours avec le portique de sécurité.",
            ]),
            ("tab", "guide", "Suivre l'avancement étape par étape dans le Guide de montage"),
            ("h", "Outils conseillés"),
            ("check", [
                "Imprimante 3D (volume 12 × 12 × 12 cm suffit) et PLA",
                "Fer à souder, étain, gaine thermorétractable",
                "Multimètre (indispensable pour vérifier les tensions)",
                "Tournevis, clés Allen, pince coupante, perceuse avec forets de 2 à 8 mm",
                "Colle cyanoacrylate et colle époxy, papier de verre",
                "Alimentation de laboratoire ou bloc 6 V puissant pour les essais",
            ]),
            ("h", "Réglages d'impression recommandés"),
            ("p", "D'après le tutoriel officiel : 30 % de remplissage, parois de 2,5 mm, sans radeau ni supports "
                  "(sauf mention contraire), avec une bordure (brim) pour les grandes pièces. Imprimer d'abord la pièce "
                  "CALIBRATOR pour vérifier que les pièces s'emboîteront."),
            ("h", "Règles de sécurité"),
            ("warn", "Ne jamais alimenter les servos par l'Arduino ou le Raspberry Pi. Toujours une alimentation "
                     "séparée, avec fusibles, et toutes les masses reliées."),
            ("warn", "Ne jamais laisser un servo forcer en butée : il chauffe et casse. Calibrer chaque servo avant "
                     "de le laisser bouger seul."),
            ("warn", "Garder les mains hors de portée des doigts et des bras pendant les essais. Un bouton "
                     "d'arrêt qui coupe l'alimentation des servos doit être à portée de main."),
            L("stl", "hardware", "group"),
        ],
    },
    # ------------------------------------------------------------------
    {
        "id": "tete", "title": "Tête et cou", "part": "tete", "blocks": [
            ("p", "La tête tourne à gauche et à droite (rothead), se lève et se baisse (neck), peut s'incliner "
                  "(rollNeck). La mâchoire s'ouvre quand le robot parle, les yeux bougent et peuvent contenir les caméras."),
            ("servos", "tete"),
            ("h", "Schéma de câblage"),
            ("schema", "tete"),
            ("h", "Pièces et matériel"),
            ("parts", "tete"),
            ("h", "Montage pas à pas"),
            ("steps", [
                "Imprimer les pièces du cou et de la mâchoire, du crâne et des yeux (liste ci-dessus).",
                "Assembler le mécanisme des yeux en suivant le tutoriel « Eye mechanism ». Vérifier à la main que les "
                "yeux bougent librement avant de fixer les servos.",
                "Mettre chaque servo à sa position de repos AVANT de fixer son palonnier : brancher le servo sur sa carte "
                "(canal indiqué dans le tableau), puis bouton « Repos » dans l'onglet Servos.",
                "Assembler le cou et la rotation de la tête (Neck, NeckHinge, MainGear, ServoGear, Ring…) selon le "
                "tutoriel « Neck and jaw ». Graisser légèrement les engrenages.",
                "Monter la mâchoire et son servo ; vérifier que la bouche se ferme complètement au repos.",
                "Passer les câbles des servos et des caméras vers le torse, avec des rallonges si besoin, sans les pincer "
                "dans la rotation du cou.",
            ]),
            L("neck", "eyes"),
            ("h", "Réglages"),
            ("steps", CALIBRATION),
            ("tip", "Pour la mâchoire et les yeux, les courses sont petites (quelques dizaines de degrés) : avancez "
                    "le curseur degré par degré."),
            ("h", "Test final"),
            ("check", [
                "La tête tourne de gauche à droite sans frotter ni forcer",
                "Le cou se lève et se baisse sans à-coups",
                "La mâchoire s'ouvre et se ferme, la bouche est fermée au repos",
                "Les yeux suivent le curseur dans les deux axes",
                "Avec le suivi de visage lancé, la tête suit une personne qui se déplace",
            ]),
            ("h", "Problèmes fréquents"),
            ("table", ["Problème", "Cause probable", "Solution"], [
                ["La tête tremble", "Alimentation trop faible ou gain du suivi trop fort",
                 "Vérifier le 6 V sous charge au multimètre ; baisser « gain » dans config.json (vision)"],
                ["La tête tourne à l'envers en suivant un visage", "Sens du servo", "Changer « invert » dans config.json (vision → pan ou tilt)"],
                ["La mâchoire ne se ferme pas", "Repos mal réglé", "Régler « repos » et « min » dans l'onglet Servos"],
                ["Un servo grogne au repos", "Il force en butée", "Réduire min ou max de quelques degrés"],
            ]),
            ("tab", "servos", "Régler les servos de la tête"),
        ],
    },
    # ------------------------------------------------------------------
    {
        "id": "torse", "title": "Torse et électronique", "part": "torse", "blocks": [
            ("p", "Le torse ne bouge pas seul : il porte les épaules et abrite toute l'électronique du haut du corps "
                  "(Arduino, cartes de servos, alimentation, haut-parleurs, capteur de présence)."),
            ("h", "Schéma de l'électronique"),
            ("overview",),
            ("h", "Pièces et matériel"),
            ("parts", "torse"),
            ("h", "Montage pas à pas"),
            ("steps", [
                "Imprimer et assembler les plaques du torse (Homplate…, Sternum, ThroatLower) selon le tutoriel "
                "« Shoulder and torso ».",
                "Fixer l'Arduino Mega et les 3 cartes PCA9685 sur une plaque à l'intérieur du torse, accessibles.",
                "Souder les ponts d'adresse : carte A rien (0x40), carte B pont A0 (0x41), carte C pont A1 (0x42).",
                "Câbler l'I2C : Mega broche 20 (SDA), 21 (SCL), 5 V et GND vers la carte A, puis de carte en carte.",
                "Câbler l'alimentation 6 V : bloc d'alimentation → bornier → un fusible par carte. Fils de 1,5 mm² minimum "
                "pour 10 A, 2,5 mm² pour 20 A.",
                "Relier toutes les masses : alimentation des servos, Arduino, cartes PCA9685, Raspberry Pi.",
                "Fixer les haut-parleurs et le capteur PIR, puis ranger les câbles avec des colliers.",
            ]),
            ("warn", "Avant de brancher le moindre servo : mesurer au multimètre la tension sur le bornier de chaque carte "
                     "(environ 6 V) et vérifier la polarité. Une inversion détruit les servos."),
            ("h", "Vérifier que les cartes répondent"),
            ("p", "Dans MyRobotLab, après l'avoir démarré avec InMoov2 et la Mega connectée : onglet Schémas → "
                  "« Appliquer à MyRobotLab ». Ensuite, dans l'onglet Servos, bouger un servo de chaque carte."),
            ("tab", "schema", "Voir le script et appliquer le câblage"),
            ("h", "Problèmes fréquents"),
            ("table", ["Problème", "Cause probable", "Solution"], [
                ["Aucun servo d'une carte ne bouge", "Adresse I2C ou câble I2C", "Vérifier les ponts soudés et le câble SDA/SCL ; une seule carte par adresse"],
                ["Les servos bougent au hasard", "Masses non reliées", "Relier la masse de l'alimentation des servos à celle de l'Arduino"],
                ["L'Arduino redémarre quand les servos bougent", "Alimentation commune ou trop faible", "Alimentations séparées ; ne jamais alimenter les servos par l'Arduino"],
                ["Un fusible saute", "Servo bloqué ou court-circuit", "Débrancher les servos un par un pour trouver le coupable"],
            ]),
            L("shoulder", "hardware"),
        ],
    },
    # ------------------------------------------------------------------
    {
        "id": "bras", "title": "Bras (épaule, omoplate, biceps)", "part": "bras", "blocks": [
            ("p", "Chaque bras a quatre mouvements : omoplate (lever le bras sur le côté), épaule (lever le bras vers "
                  "l'avant), rotation du bras et biceps (plier le coude). Ce sont les servos les plus puissants (HS-805BB)."),
            ("servos", "bras"),
            ("h", "Schéma de câblage"),
            ("schema", "bras"),
            ("h", "Pièces et matériel"),
            ("parts", "bras"),
            ("h", "Le point important : le potentiomètre déporté"),
            ("p", "L'épaule, l'omoplate et la rotation sont entraînées par des vis sans fin : le servo tourne beaucoup "
                  "plus que l'articulation. On démonte donc le servo pour sortir son potentiomètre interne et le fixer "
                  "sur l'articulation, pour que le servo mesure la vraie position du bras. Les tutoriels officiels "
                  "montrent cette modification pas à pas. Certains servos ont un potentiomètre carré, d'autres rond : "
                  "il existe une pièce imprimée pour chaque forme (PivPotentio Round ou Square)."),
            ("warn", "Pendant la modification, noter la position du potentiomètre au repos : le tutoriel MyRobotLab indique "
                     "omoplate 10, épaule environ 30 et rotation 90 (sur 0 à 180). Un potentiomètre mal positionné fait "
                     "tourner le servo sans s'arrêter."),
            ("h", "Montage pas à pas"),
            ("steps", [
                "Imprimer d'abord la pièce CALIBRATOR et vérifier l'ajustement.",
                "Assembler l'épaule (Clavi…, Piston…, Piv…) et l'omoplate selon le tutoriel « Shoulder and torso ».",
                "Modifier les servos (potentiomètre déporté) en suivant le tutoriel, un servo à la fois.",
                "Assembler le biceps : coller HighArmSide et LowArmSide, monter RotGear et RotWorm (avec de la graisse), "
                "puis l'ElbowShaftGear collé au RobCap.",
                "Brancher chaque servo sur sa carte (gauche : carte B, droite : carte C, canaux 0 à 3).",
                "Avant le premier mouvement, mettre une vitesse basse (par exemple 20 °/s) dans l'onglet Servos.",
            ]),
            L("bicep", "shoulder", "mrl_defaults"),
            ("h", "Réglages"),
            ("steps", CALIBRATION),
            ("tip", "Le bras porte du poids : faites les essais bras soutenu, et gardez une vitesse basse jusqu'à ce que "
                    "toutes les limites soient réglées."),
            ("h", "Test final"),
            ("check", [
                "Chaque articulation va d'une limite à l'autre sans forcer",
                "Le bras tient sa position quand on le lâche (pas de descente lente)",
                "Aucun servo ne chauffe anormalement après 5 minutes",
                "Le courant de la carte reste raisonnable (onglet Capteurs, si installé)",
            ]),
            ("h", "Problèmes fréquents"),
            ("table", ["Problème", "Cause probable", "Solution"], [
                ["Le servo tourne sans s'arrêter", "Potentiomètre mal positionné ou débranché", "Couper l'alimentation, revoir le montage du potentiomètre"],
                ["Le bras descend tout seul", "Servo trop faible ou vis sans fin usée", "Vérifier la tension 6 V, graisser, changer le servo"],
                ["Bruit de craquement", "Engrenage qui saute", "Revoir l'alignement de la vis sans fin et de la roue"],
            ]),
            ("tab", "servos", "Régler les servos des bras"),
        ],
    },
    # ------------------------------------------------------------------
    {
        "id": "mains", "title": "Mains et avant-bras", "part": "mains", "blocks": [
            ("p", "Les doigts sont tirés par des tendons en fil tressé, reliés aux servos logés dans l'avant-bras. "
                  "Le poignet tourne avec son propre servo. Dans InMoov2, 0 = doigt ouvert, 180 = fermé."),
            ("servos", "mains"),
            ("h", "Schéma de câblage"),
            ("schema", "mains"),
            ("h", "Pièces et matériel"),
            ("parts", "mains"),
            ("h", "Montage pas à pas"),
            ("steps", [
                "Imprimer les doigts, la paume et l'avant-bras ; poncer les articulations pour qu'elles bougent librement.",
                "Assembler les doigts et la main selon le tutoriel « Hand and forarm ».",
                "Assembler le lit des servos (RobPart2 + RobPart5, RobPart3 + RobPart4) et y fixer les servos.",
                "Mettre chaque servo de doigt à sa position de départ (0 = main ouverte) avec le bouton « Repos » de "
                "l'onglet Servos, AVANT de fixer les poulies.",
                "Passer les tendons sans les croiser ni les tordre, faire 3 ou 4 nœuds au bout du doigt avec une goutte "
                "de colle, puis les tendre sur la poulie main ouverte (tutoriel « Lining and tighting the tendons »).",
                "Finir par deux nœuds de sécurité, faciles à défaire pour retendre plus tard.",
                "Monter le poignet (RotaWrist, WristGears) et son servo MG996R.",
                "Nouveau : coller un capteur de force FSR sous le bout de chaque doigt (voir chapitre Capteurs).",
            ]),
            L("hand", "tendons"),
            ("h", "Réglages"),
            ("steps", CALIBRATION),
            ("tip", "Si un doigt ne se ferme pas complètement, retendre le tendon plutôt que d'augmenter le max : "
                    "un servo qui force pour fermer un doigt mal tendu chauffe."),
            ("h", "Test final"),
            ("check", [
                "Les 5 doigts s'ouvrent et se ferment (InMoov2 « open » / « close »)",
                "La main tient une balle de tennis sans que les servos grognent",
                "Le poignet tourne sans entraîner les tendons",
                "Avec les capteurs : « Prise douce » arrête chaque doigt au contact",
            ]),
            ("h", "Problèmes fréquents"),
            ("table", ["Problème", "Cause probable", "Solution"], [
                ["Un doigt reste à moitié plié", "Tendon trop tendu ou articulation qui frotte", "Détendre légèrement ; poncer l'articulation"],
                ["Un doigt ne se ferme pas", "Tendon détendu ou nœud qui a glissé", "Retendre main ouverte, refaire les nœuds"],
                ["Les doigts bougent ensemble", "Tendons croisés", "Repasser les tendons sans les croiser"],
            ]),
            ("tab", "sensors", "Tester le toucher et la prise douce"),
        ],
    },
    # ------------------------------------------------------------------
    {
        "id": "bassin", "title": "Bassin et ventre", "part": "bassin", "blocks": [
            ("p", "Le ventre relie le torse au bassin. Le ventre haut (topStom) et le ventre milieu (midStom) "
                  "permettent au buste de bouger ; lowStom est optionnel. Le bassin est aussi le bon endroit pour "
                  "l'électronique des jambes et la batterie (centre de gravité bas)."),
            ("servos", "bassin"),
            ("h", "Schéma de câblage"),
            ("schema", "bassin"),
            ("h", "Pièces et matériel"),
            ("parts", "bassin"),
            ("h", "Montage pas à pas"),
            ("steps", [
                "Imprimer les pièces du ventre haut et du ventre milieu.",
                "Assembler le ventre haut (disques, pistons, StomGear) selon le tutoriel « Top stomach ».",
                "Assembler le ventre milieu selon le tutoriel « Mid stomach » : les deux moteurs (Vigor VSD-11AYMB ou "
                "CYS-S8218) partagent une seule carte de servo et un seul potentiomètre, pour tourner ensemble.",
                "Brancher les servos sur la carte A (canaux 8 à 10) ; un servo double utilise un câble en Y.",
                "Prévoir dans le bassin la place pour l'Arduino Mega n°2, le capteur BNO085, la batterie et le bouton d'arrêt.",
            ]),
            L("topstom", "midstom"),
            ("h", "Réglages"),
            ("steps", CALIBRATION),
            ("warn", "Le ventre porte tout le haut du corps : vitesse basse pendant les essais, et calibrer avec le "
                     "robot soutenu."),
            ("tab", "servos", "Régler le ventre (partie « Torse » dans l'onglet Servos)"),
        ],
    },
    # ------------------------------------------------------------------
    {
        "id": "jambes", "title": "Jambes motorisées", "part": "jambes", "blocks": [
            ("p", "Il n'existe pas de jambes InMoov motorisées officielles : celles publiées sont statiques. "
                  "L'Atelier fournit le firmware Arduino, le pilotage et le calcul des moteurs pour 12 articulations "
                  "(6 par jambe), avec des servos « bus » Feetech chaînés."),
            ("warn", "Tous les essais se font robot accroché à un portique (sangle au bassin), avec un arrêt d'urgence "
                     "qui coupe l'alimentation des servos. Le firmware fige les articulations en cas de défaut, mais ne "
                     "remplace pas ces deux protections."),
            ("h", "Schéma de câblage"),
            ("schema", "jambes"),
            ("parts", "jambes"),
            ("h", "Choisir les moteurs"),
            ("steps", [
                "Peser le haut du corps et mesurer la cuisse et le tibia.",
                "Lancer le calcul de couple (commande ci-dessous) avec votre masse.",
                "Sans réduction, les servos de modélisme ne suffisent pas pour tenir sur une jambe : prévoir une "
                "réduction 3:1 à 5:1 (poulies crantées) ou des moteurs plus puissants.",
            ]),
            ("cmd", ["cd legs", "python3 torque_calc.py --masse 18 --reduction 4"]),
            ("h", "Montage et mise en service"),
            ("steps", [
                "Programmer l'identifiant de chaque servo un par un (1 à 6 jambe gauche, 11 à 16 jambe droite).",
                "Calibrer le milieu (2048) de chaque servo, jambe tendue.",
                "Câbler : Mega n°2 Serial1 → adaptateur bus → servos ; BNO085 en I2C ; bouton d'arrêt sur la broche 2.",
                "Téléverser le firmware (onglet Arduino → Jambes).",
                "Onglet Jambes : connecter, cocher « robot sur portique », RESET, puis la pose test_genoux_5deg.",
                "Vérifier le sens de chaque articulation ; corriger « direction » dans la config des jambes si besoin.",
                "Seulement ensuite : flexions, puis balancement.",
            ]),
            ("tab", "legs", "Ouvrir l'onglet Jambes"),
            ("h", "Capteurs d'équilibre pour la marche"),
            ("p", "Pour marcher, le robot doit savoir s'il penche et sur quel pied il s'appuie. Deux capteurs : la "
                  "centrale BNO085 au centre du bassin (inclinaison et vitesse de basculement) et 4 cellules de charge "
                  "sous chaque pied (poids et centre de pression : le point où le poids appuie). C'est la méthode "
                  "utilisée par les équipes de robots humanoïdes de la RoboCup."),
            ("warn", "Les capteurs FSR (ceux des doigts) ne conviennent pas sous les pieds : ils saturent vers 10 N, "
                     "soit environ 1 kg. Il faut des cellules de charge."),
            ("steps", [
                "Faire chaque pied en deux plaques rigides : celle du dessus fixée à la cheville, la semelle en dessous. "
                "Une cellule de charge à chaque coin, prise entre les deux plaques (seules les cellules transmettent le poids).",
                "Brancher chaque cellule sur son module HX711 (rouge E+, noir E−, vert A+, blanc A− pour la plupart des "
                "cellules : vérifier la fiche du vendeur). Relier la broche RATE de chaque HX711 au 5 V (80 mesures/s).",
                "Relier les HX711 à l'Arduino Mega n°2 selon le tableau des cellules sous le schéma (5 V et GND communs).",
                "Avant de monter les pieds : étalonner chaque cellule seule. Robot hors tension des servos, onglet "
                "Jambes connecté : « Tare », puis poser une masse connue (ex. 2 kg) sur une cellule et lancer la "
                "commande feet cal (numéro de cellule, masse en grammes). Recommencer pour les 8 cellules. "
                "Les réglages restent dans l'Arduino (EEPROM).",
                "Pieds montés, robot suspendu au portique, pieds en l'air : « Tare (pieds en l'air) ».",
                "Poser le robot sur ses pieds (toujours accroché) : les deux poids et les points rouges doivent "
                "apparaître. Le total doit être proche du poids du robot.",
                "Cliquer « Surveiller sans bouger », puis pencher le robot à la main vers l'avant : la correction "
                "« tangage » doit devenir négative (pointes des pieds vers le bas). Sinon mettre imu_pitch_sign à -1 "
                "dans la config des jambes. Même test vers la droite pour le roulis (imu_roll_sign).",
                "Seulement ensuite : « Équilibre ACTIF ». Pousser doucement le bassin : les chevilles compensent. "
                "Si le robot oscille, diminuer kp ; s'il réagit trop peu, l'augmenter par pas de 0,05.",
                "Enfin, la séquence pas_sur_place : elle ne lève un pied que lorsque l'autre porte 85 % du poids, "
                "sinon elle fige les jambes. Ajuster les poses transfert_* (roulis des hanches et des chevilles) "
                "jusqu'à atteindre ce report de poids.",
            ]),
            ("cmd", ["cd legs",
                     "python3 legs_controller.py --config legs_config.json feet tare",
                     "python3 legs_controller.py --config legs_config.json feet cal 0 2000",
                     "python3 legs_controller.py --config legs_config.json balance monitor",
                     "python3 legs_controller.py --config legs_config.json sequence pas_sur_place"]),
            ("table", ["Réglage (config des jambes → balance)", "Rôle", "Départ"], [
                ["kp", "Correction des chevilles par degré d'inclinaison du bassin", "0,3"],
                ["kd", "Freine le basculement (par degré/seconde)", "0,02"],
                ["kc", "Ramène le centre de pression au milieu du pied", "3"],
                ["max_deg", "Correction maximale des chevilles (10° au plus)", "5"],
                ["contact_kg", "Poids sous lequel un pied est considéré en l'air", "1"],
            ]),
            ("tip", "Ce que fait le firmware : 50 fois par seconde, il ajoute une petite correction aux chevilles "
                    "(stratégie de cheville, comme un humain qui se rattrape avec les pieds). La correction est "
                    "limitée, progressive, et revient à zéro dès que les pieds quittent le sol ou en cas de défaut. "
                    "C'est une marche lente « quasi statique » : le poids reste toujours au-dessus d'un pied. "
                    "La marche dynamique des robots du commerce demande des moteurs bien plus puissants et rapides."),
            ("h", "Problèmes fréquents"),
            ("table", ["Message", "Signification", "Solution"], [
                ["démarrage (envoyer RESET)", "Normal au démarrage", "Cocher « robot sur portique » puis RESET"],
                ["servo X ne répond pas", "Câble bus, identifiant ou alimentation", "Vérifier le câble chaîné et l'identifiant du servo"],
                ["surcharge / trop chaud", "Le servo force", "Laisser refroidir, vérifier la mécanique et le couple"],
                ["inclinaison", "Le bassin penche de plus de 20°", "Remettre le robot droit sur le portique"],
                ["plus de battement de coeur", "Le Pi ne communique plus", "Reconnecter dans l'onglet Jambes"],
                ["Cellules absentes ou non étalonnées", "Un HX711 ne répond pas, ou tare / étalonnage pas faits",
                 "Vérifier DOUT/SCK et le 5 V, puis faire la tare et feet cal"],
                ["cellule absente N (à la tare)", "Le HX711 n° N ne donne pas de mesure", "Vérifier son câblage (tableau des cellules)"],
                ["Un pied affiche 0 kg posé au sol", "La semelle touche la plaque du dessus ailleurs qu'aux cellules",
                 "Ajouter des entretoises : seules les cellules doivent porter"],
                ["appui gauche/droite insuffisant", "Le poids ne passe pas assez sur un pied avant de lever l'autre",
                 "Augmenter le roulis des poses transfert_* (par pas de 1°)"],
                ["Les chevilles vibrent", "Équilibre trop nerveux", "Diminuer kp et kd"],
            ]),
        ],
    },
    # ------------------------------------------------------------------
    {
        "id": "capteurs", "title": "Capteurs (courant, toucher, présence)", "part": "capteurs", "blocks": [
            ("p", "Les capteurs se branchent directement sur le Raspberry Pi (bus I2C). Ils protègent le robot "
                  "(coupure si un servo force), surveillent la batterie, donnent le toucher aux doigts et détectent "
                  "les personnes."),
            ("schema", "capteurs"),
            ("parts", "capteurs"),
            ("warn", "Le module INA226 courant a une résistance de mesure de 0,1 Ω, prévue pour 0,8 A maximum. Pour des "
                     "servos, la remplacer par 1 à 2 mΩ et indiquer la valeur dans config.json (shunt_ohm)."),
            ("h", "Installation"),
            ("cmd", [
                "sudo raspi-config nonint do_i2c 0",
                "sudo apt install -y i2c-tools && i2cdetect -y 1",
                "python3 -m venv .venv-sensors && .venv-sensors/bin/pip install -r sensors/requirements.txt",
                "cd sensors && ../.venv-sensors/bin/python sensor_hub.py --config ../config.json --simulate",
            ]),
            ("p", "i2cdetect doit afficher les adresses du tableau. Essayer d'abord avec --simulate, puis sans."),
            ("tab", "sensors", "Ouvrir l'onglet Capteurs"),
        ],
    },
    # ------------------------------------------------------------------
    {
        "id": "logiciel", "title": "Logiciel (Raspberry Pi, MyRobotLab, Atelier)", "blocks": [
            ("h", "Raspberry Pi 5"),
            ("steps", [
                "Installer Raspberry Pi OS 64 bits (Bookworm) avec Raspberry Pi Imager ; activer SSH et le Wi-Fi.",
                "Utiliser l'alimentation officielle 5 V / 5 A.",
                "Copier le dossier inmoov dans le dossier personnel, puis créer config.json à partir de l'exemple.",
            ]),
            ("cmd", ["sudo apt update && sudo apt full-upgrade -y", "cd ~/inmoov && cp config.example.json config.json"]),
            ("h", "MyRobotLab (Nixie) et InMoov2"),
            ("steps", [
                "Installer Java 11 (64 bits).",
                "Télécharger MyRobotLab Nixie, le décompresser (par exemple ~/mrl) et lancer myrobotlab.sh.",
                "Démarrer InMoov2 ; l'interface de MyRobotLab répond sur le port 8888.",
                "Indiquer le dossier de MyRobotLab dans l'onglet Réglages de l'Atelier.",
            ]),
            L("mrl_start", "nixie"),
            ("h", "L'Atelier (cette application)"),
            ("cmd", [
                "cd ~/inmoov && python3 -m venv .venv-app && .venv-app/bin/pip install -r app/requirements.txt",
                "sudo usermod -aG dialout $USER",
                "cd app && ../.venv-app/bin/python app.py --port 8090",
            ]),
            ("p", "Sous Windows (pour consulter la documentation sur un PC), dans le dossier inmoov :"),
            ("cmd", [
                "python -m venv .venv-app",
                ".\\.venv-app\\Scripts\\pip.exe install -r app\\requirements.txt",
                ".\\.venv-app\\Scripts\\python.exe app\\app.py --port 8091",
            ]),
            ("h", "Démarrage automatique"),
            ("cmd", [
                "sudo cp ~/inmoov/systemd/inmoov-*.service /etc/systemd/system/",
                "sudo systemctl daemon-reload",
                "sudo systemctl enable --now inmoov-app inmoov-vision inmoov-voice inmoov-sensors",
            ]),
            ("tip", "Si votre nom d'utilisateur n'est pas « pi », adaptez les fichiers .service avant de les copier "
                    "(chemins /home/pi et ligne User=pi)."),
            ("h", "Mettre à jour l'Atelier"),
            ("steps", [
                "Retélécharger le ZIP de la branche sur GitHub.",
                "Le décompresser au même endroit en remplaçant les fichiers : config.json et le dossier data sont conservés.",
                "Relancer l'Atelier et faire Ctrl + F5 dans le navigateur.",
            ]),
            ("h", "Sauvegarder"),
            ("p", "À sauvegarder régulièrement sur une clé USB : config.json, legs/legs_config.json, le dossier data "
                  "(souvenirs, gestes appris) et app/data (calibrations, avancement)."),
        ],
    },
    # ------------------------------------------------------------------
    {
        "id": "ia", "title": "Vision, voix et intelligence", "blocks": [
            ("table", ["Fonction", "Programme", "Réglage dans config.json"], [
                ["Suivi de visage (Coral)", "vision/face_tracker.py", "vision"],
                ["Écoute (Whisper) et commandes", "voice/speech_listener.py", "voice"],
                ["Conversation avec Claude, vision, gestes, mémoire", "voice/llm_brain.py", "brain"],
                ["IA locale de secours", "voice/llm_local.py", "local_llm"],
                ["Voix hors ligne Piper", "voice/tts_piper.py", "voice.tts = \"piper\""],
                ["Imitation et gestes appris", "vision/mirror.py", "mirror"],
            ]),
            ("h", "Mise en route de l'IA"),
            ("steps", [
                "Créer une clé API sur platform.claude.com (usage payant).",
                "La mettre dans ~/inmoov/anthropic.env (ANTHROPIC_API_KEY=...), puis chmod 600.",
                "Dans config.json → brain : votre prénom (owner_name) et le nom du robot.",
                "Tester sans bouger le robot : speech_listener.py avec --dry-run.",
            ]),
            ("h", "Ce qu'on peut dire au robot"),
            ("table", ["Phrase", "Ce qui se passe"], [
                ["« InMoov, regarde à gauche »", "Commande locale immédiate"],
                ["« InMoov, qu'est-ce que je tiens ? »", "L'IA prend une photo et la décrit"],
                ["« InMoov, je m'appelle Paul »", "L'IA retient le prénom pour les prochaines fois"],
                ["« InMoov, fais le geste salut »", "Joue un geste appris par imitation"],
                ["« InMoov » (seul)", "Le robot répond « oui ? » et écoute la phrase suivante"],
            ]),
            ("h", "Apprendre un geste en le montrant"),
            ("cmd", [
                "sudo systemctl stop inmoov-vision",
                "cd ~/inmoov/vision && ../.venv-mirror/bin/python mirror.py --config ../config.json --dry-run -v",
                "../.venv-mirror/bin/python mirror.py --config ../config.json --record salut",
            ]),
            ("tab", "ai", "Gérer les souvenirs et les gestes appris"),
            ("p", "Pour aller plus loin, le comparatif avec l'état de l'art est dans docs/veille-robotique.md."),
        ],
    },
    # ------------------------------------------------------------------
    {
        "id": "depannage", "title": "Dépannage général", "blocks": [
            ("table", ["Problème", "Où regarder", "Solution"], [
                ["« MyRobotLab injoignable »", "Tableau de bord", "Démarrer MyRobotLab et InMoov2 ; vérifier l'adresse dans Réglages (port 8888)"],
                ["Un servo ne bouge pas", "Schémas → carte et canal", "Câble sur le bon canal, carte alimentée, câblage appliqué à MyRobotLab"],
                ["Tous les servos d'une carte sont coupés", "Onglet Capteurs", "Surintensité : chercher le servo bloqué, puis « Réarmer »"],
                ["Servos qui tremblent", "Multimètre sur le bornier", "Alimentation trop faible ou masses non reliées"],
                ["« Coral : absent »", "lsusb", "Rebrancher sur un port USB 3 (bleu), vérifier le pilote libedgetpu"],
                ["Le robot n'entend pas", "journal de inmoov-voice", "Choisir le bon micro (--list-devices), baisser vad_aggressiveness"],
                ["Le robot répond à côté", "journal de inmoov-voice", "Ajouter les mots difficiles dans « vocabulary »"],
                ["Pas de réponse de l'IA", "journal de inmoov-voice", "Clé ANTHROPIC_API_KEY, connexion Internet ; sinon IA locale ou chatbot"],
                ["Téléversement Arduino impossible", "Onglet Arduino", "Arrêter MyRobotLab (port occupé), choisir le bon port"],
                ["L'Atelier affiche un autre site", "Port", "Lancer l'Atelier avec --port 8091"],
                ["« un n'est pas reconnu » (PowerShell)", "Commande tapée", "Ne copier que les commandes, pas les messages affichés"],
            ]),
            ("h", "Voir ce qui se passe"),
            ("cmd", ["journalctl -u inmoov-voice -f", "journalctl -u inmoov-vision -f", "journalctl -u inmoov-sensors -f"]),
            ("tab", "services", "Ouvrir les journaux dans l'onglet Services"),
            ("h", "Trouver de l'aide"),
            L("group", "mrl"),
            ("p", "Pour demander de l'aide, donnez toujours : la partie concernée, ce que vous avez fait, le message "
                  "exact affiché et une photo du câblage."),
        ],
    },
    # ------------------------------------------------------------------
    {
        "id": "liens", "title": "Tous les liens", "blocks": [
            ("h", "Site officiel InMoov"),
            L("stl", "hardware", "hand", "tendons", "bicep", "shoulder", "neck", "eyes", "topstom", "midstom"),
            ("h", "MyRobotLab"),
            L("mrl_start", "nixie", "mrl_defaults", "mrl"),
            ("h", "Communauté"),
            L("group"),
        ],
    },
]


def chapter_list():
    return [{"id": c["id"], "title": c["title"]} for c in CHAPTERS]


def get_chapter(chapter_id):
    for c in CHAPTERS:
        if c["id"] == chapter_id:
            return c
    return None


def serialize(chapter, part_view):
    """Transforme les blocs en JSON ; part_view(clé) donne les données d'une partie."""
    blocks = []
    for b in chapter["blocks"]:
        kind = b[0]
        if kind in ("p", "h", "warn", "tip"):
            blocks.append({"type": kind, "text": b[1]})
        elif kind in ("steps", "check", "cmd"):
            blocks.append({"type": kind, "items": list(b[1])})
        elif kind == "table":
            blocks.append({"type": "table", "headers": b[1], "rows": b[2]})
        elif kind == "links":
            blocks.append({"type": "links", "items": [{"title": t, "url": u} for t, u in b[1]]})
        elif kind in ("schema", "servos", "parts"):
            blocks.append({"type": kind, "part": b[1], "view": part_view(b[1])})
        elif kind == "overview":
            blocks.append({"type": "overview"})
        elif kind == "tab":
            blocks.append({"type": "tab", "tab": b[1], "text": b[2]})
        else:
            raise ValueError("bloc inconnu : %s" % kind)
    return {"id": chapter["id"], "title": chapter["title"], "blocks": blocks}
