// ═══════════════════════════════════════════════════════════════════════════
//  POIGNÉE DE PORTE (étrier / D-handle) — caisson d'imprimante
//
//  Pas d'esquisse à contraindre, pas de contour ouvert : la forme est obtenue
//  par enveloppes convexes (hull) entre des sphères et des cylindres, ce qui
//  donne des raccordements lisses sans le moindre congé à poser.
//
//  ── UTILISATION ──────────────────────────────────────────────────────────
//  1. Ouvrir dans OpenSCAD (gratuit : openscad.org)
//  2. Ajuster les valeurs de la section RÉGLAGES
//  3. F5 pour l'aperçu, F6 pour le rendu final
//  4. Fichier → Exporter → Exporter en STL
//
//  ⚠️ MESURER D'ABORD sur la porte : l'entraxe des trous existants (ou le
//     choisir librement si tu perces), et l'épaisseur de la porte pour la
//     longueur de vis.
// ═══════════════════════════════════════════════════════════════════════════

/* [Dimensions principales] */
entraxe       = 96;    // distance entre les CENTRES des deux vis (mm)
hauteur       = 42;    // hauteur de la barre au-dessus de la porte
                       //   35 mm = juste pour les doigts, 45 mm = confortable
diam_barre    = 18;    // diamètre de la barre qu'on empoigne
diam_pied     = 22;    // diamètre des pieds (> diam_barre = plus solide)

/* [Visserie] */
vis_d         = 4.4;   // perçage de passage : M4 = 4.4, M5 = 5.4
tete_d        = 8.4;   // lamage pour la tête : M4 = 8.4, M5 = 10.4
tete_h        = 4.5;   // profondeur du lamage (tête + rondelle)
lamage        = true;  // false = pas de lamage, la tête dépasse

/* [Confort] */
meplat_prise  = true;  // aplatit légèrement le dessus de la barre : plus
                       //   agréable en main qu'un rond parfait
meplat_ratio  = 0.85;  // 1.0 = rond pur, 0.8 = bien aplati

/* [Rendu] */
$fn = 64;
eps = 0.01;

// ═══════════════════════════════════════════════════════════════════════════

module corps() {
    dx = entraxe / 2;
    zb = hauteur - diam_barre / 2;   // hauteur de l'axe de la barre

    // ── Les deux pieds : base plate contre la porte, coude arrondi en haut
    for (s = [-1, 1])
        hull() {
            // embase plate (2 mm) pour reposer à plat sur la porte
            translate([s * dx, 0, 0])  cylinder(d = diam_pied, h = 2);
            // sphère au sommet du pied = naissance du coude
            translate([s * dx, 0, zb]) sphere(d = diam_barre);
        }

    // ── La barre horizontale entre les deux coudes
    hull()
        for (s = [-1, 1])
            translate([s * dx, 0, zb]) sphere(d = diam_barre);
}

module meplat() {
    // Coupe une fine tranche sur le dessus : la barre devient légèrement
    // ovale, ce qui la rend plus confortable et supprime le point de contact
    // unique dans la paume.
    h_coupe = hauteur * (1 - meplat_ratio);
    translate([-entraxe, -diam_pied, hauteur - h_coupe])
        cube([entraxe * 2, diam_pied * 2, h_coupe + 10]);
}

module percages() {
    dx = entraxe / 2;
    for (s = [-1, 1]) {
        // trou traversant sur toute la hauteur du pied
        translate([s * dx, 0, -1])
            cylinder(d = vis_d, h = hauteur + 2);
        // lamage : la tête de vis rentre dans le pied, côté porte
        if (lamage)
            translate([s * dx, 0, -eps])
                cylinder(d = tete_d, h = tete_h);
    }
}

module poignee() {
    difference() {
        corps();
        if (meplat_prise) meplat();
        percages();
    }
}

poignee();

// ═══════════════════════════════════════════════════════════════════════════
//  IMPRESSION
//
//  ORIENTATION — la plus importante :
//    Poser la poignée SUR LE CÔTÉ (profil à plat sur le plateau), c'est-à-dire
//    couchée, l'arche dans le plan du plateau. Les couches sont alors
//    PARALLÈLES à l'effort de traction : la poignée ne peut pas se délaminer
//    quand on tire dessus. Debout, elle casserait net entre deux couches.
//    Dans le slicer : sélectionner la pièce → Rotation 90° sur X.
//    Aucun support nécessaire dans cette orientation.
//
//  MATÉRIAU
//    PETG ou ABS. SURTOUT PAS de PLA : un caisson d'imprimante monte à
//    40-50 °C, et le PLA flue (se déforme lentement sous charge) dès 50-55 °C.
//    La poignée finirait molle et tordue.
//
//  RÉGLAGES
//    Parois : 5   ·   Remplissage : 40-50 % (gyroïde)   ·   Couche : 0.2
//    C'est une pièce mécanique, pas décorative : ne pas descendre en dessous.
//
//  MONTAGE
//    Vis M4 traversantes + écrous côté intérieur, ou vis à bois si la porte
//    est en panneau. Longueur = épaisseur de la porte + 8 mm environ.
// ═══════════════════════════════════════════════════════════════════════════
