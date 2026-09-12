// ═══════════════════════════════════════════════════════════════════════════
//  ESSUIE-BUSE double lèvre + goulotte — VCore 3.1
//
//  Conception : la buse passe ENTRE deux lèvres silicone opposées, ce qui
//  l'essuie des deux côtés en un seul passage (au lieu d'un seul côté avec
//  une lèvre unique). Fixation sur profilé par trous OBLONGS verticaux : la
//  hauteur se rattrape quand le silicone s'use, sans réimprimer.
//
//  Sur une VCore 3 le portique est fixe en Z : une fois la hauteur réglée,
//  elle ne bouge plus jamais.
//
//  ── UTILISATION ──────────────────────────────────────────────────────────
//  1. Ouvre ce fichier dans OpenSCAD (gratuit : openscad.org)
//  2. Ajuste les paramètres de la section RÉGLAGES ci-dessous
//  3. F5 pour prévisualiser, F6 pour le rendu final
//  4. Fichier → Exporter → Exporter en STL
//
//  ⚠️ MESURE D'ABORD (les 3 valeurs critiques) :
//     - la largeur de rainure de ton profilé (VCore 3 = 3030, rainure 8 mm)
//     - l'épaisseur de ta bande silicone
//     - la distance profilé → buse, pour régler arm_length
// ═══════════════════════════════════════════════════════════════════════════

/* [RÉGLAGES — fixation sur profilé] */
extrusion_slot_w   = 8;      // largeur de rainure du profilé (3030 → 8 mm)
screw_d            = 6.4;    // diamètre de passage vis M6 (jeu inclus)
screw_head_d       = 11.5;   // diamètre tête vis M6 (lamage)
screw_spacing      = 30;     // entraxe vertical des 2 vis
slot_travel        = 8;      // course du réglage en hauteur (trou oblong)
back_plate_w       = 26;     // largeur de la plaque arrière
back_plate_t       = 7;      // épaisseur de la plaque arrière

/* [RÉGLAGES — bras] */
arm_length         = 45;     // longueur profilé → centre de la brosse
arm_w              = 22;     // largeur du bras
arm_t              = 8;      // épaisseur du bras (rigidité)

/* [RÉGLAGES — lèvres silicone] */
lip_slot_t         = 2.0;    // épaisseur de ta bande silicone (+0.2 de jeu)
lip_gap            = 3.0;    // écart entre les 2 lèvres — un peu MOINS que
                             //   le diamètre du corps de buse pour que ça
                             //   frotte. 3 mm convient pour une buse standard.
lip_slot_depth     = 9;      // profondeur d'enfoncement des bandes
lip_holder_w       = 34;     // largeur du porte-lèvres (= longueur essuyée)
lip_holder_h       = 14;     // hauteur du bloc porte-lèvres

/* [RÉGLAGES — goulotte d'évacuation] */
chute_enabled      = true;   // false = pas de goulotte
chute_len          = 26;     // longueur de la goulotte
chute_angle        = 35;     // inclinaison (°) — plus = évacue mieux
chute_wall         = 2.0;    // épaisseur de paroi

/* [Rendu] */
$fn = 48;
eps = 0.01;

// ═══════════════════════════════════════════════════════════════════════════

module slotted_hole(d, travel, depth) {
    // Trou oblong vertical = réglage de hauteur après montage
    hull() {
        translate([0, 0,  travel/2]) rotate([90,0,0]) cylinder(d = d, h = depth, center = true);
        translate([0, 0, -travel/2]) rotate([90,0,0]) cylinder(d = d, h = depth, center = true);
    }
}

module back_plate() {
    difference() {
        // plaque contre le profilé, coins adoucis
        translate([-back_plate_w/2, 0, -(screw_spacing/2 + 14)])
            cube([back_plate_w, back_plate_t, screw_spacing + 28]);

        // 2 fixations oblongues M6
        for (z = [-screw_spacing/2, screw_spacing/2]) {
            translate([0, back_plate_t/2, z]) {
                slotted_hole(screw_d, slot_travel, back_plate_t + 2);
                // lamage de tête, côté extérieur
                translate([0, -back_plate_t/2 + 3.2, 0])
                    slotted_hole(screw_head_d, slot_travel, back_plate_t);
            }
        }
    }
}

module arm() {
    // Bras cantilever + gousset triangulaire pour la rigidité
    translate([-arm_w/2, back_plate_t - eps, -arm_t/2])
        cube([arm_w, arm_length, arm_t]);

    // gousset : évite que le bras fléchisse au contact de la buse
    translate([-arm_w/2, back_plate_t - eps, -arm_t/2])
        rotate([0, -90, 0])
            linear_extrude(height = arm_w)
                polygon([[0,0], [0, arm_length*0.55], [arm_length*0.55, 0]]);
}

module lip_holder() {
    // Bloc percé de 2 fentes verticales qui reçoivent les bandes silicone.
    // La buse passe dans l'espace « lip_gap » entre les deux.
    y0 = back_plate_t + arm_length;

    difference() {
        translate([-lip_holder_w/2, y0 - lip_holder_h/2, -arm_t/2])
            cube([lip_holder_w, lip_holder_h, lip_holder_h]);

        // couloir de passage de la buse (traversant en X)
        translate([-lip_holder_w/2 - 1, y0 - lip_gap/2, -arm_t/2 + 4])
            cube([lip_holder_w + 2, lip_gap, lip_holder_h]);

        // les 2 fentes à bandes silicone, de part et d'autre du couloir
        for (s = [-1, 1]) {
            translate([-lip_holder_w/2 - 1,
                       y0 + s*(lip_gap/2 + lip_slot_t/2) - lip_slot_t/2,
                       -arm_t/2 + lip_holder_h - lip_slot_depth])
                cube([lip_holder_w + 2, lip_slot_t, lip_slot_depth + 1]);
        }
    }
}

module chute() {
    // Goulotte inclinée sous le porte-lèvres : les résidus glissent au lieu
    // de s'accumuler sur la pièce.
    y0 = back_plate_t + arm_length;
    translate([0, y0, -arm_t/2])
        rotate([chute_angle, 0, 0])
            difference() {
                translate([-lip_holder_w/2, -chute_len, -chute_wall])
                    cube([lip_holder_w, chute_len, chute_wall]);
                // rebords latéraux creusés pour canaliser
                translate([-lip_holder_w/2 + chute_wall, -chute_len - 1, -chute_wall - 1])
                    cube([lip_holder_w - 2*chute_wall, chute_len + 2, chute_wall]);
            }
}

module nozzle_wiper() {
    back_plate();
    arm();
    lip_holder();
    if (chute_enabled) chute();
}

nozzle_wiper();

// ═══════════════════════════════════════════════════════════════════════════
//  IMPRESSION
//    Orientation : plaque arrière à plat sur le plateau (bras vers le haut)
//    Matériau    : PETG ou ABS — surtout PAS de PLA, la buse chaude passe à
//                  côté et le PLA flue vers 60 °C
//    Parois      : 4 · Remplissage : 40 % · Supports : uniquement sous le bras
//
//  RÉGLAGE APRÈS MONTAGE
//    1. Visse sans serrer à fond (les trous oblongs laissent du jeu)
//    2. G28 puis descends le plateau (G1 Z80)
//    3. Amène la buse au niveau des lèvres, ajuste la hauteur à la main
//       pour que les lèvres frottent franchement sans forcer
//    4. Serre les vis
//    5. Relève X d'entrée / X de sortie / Y → à reporter dans _WIPE_CONF
//       du fichier nozzle-wiper.cfg
// ═══════════════════════════════════════════════════════════════════════════
