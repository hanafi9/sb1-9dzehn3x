// ═══════════════════════════════════════════════════════════════════════════
//  POIGNÉE BARRE BOMBÉE À RAINURES — caisson d'imprimante
//
//  Barre allongée, légèrement bombée sur sa longueur, bouts arrondis, avec
//  des rainures longitudinales creusées dans la face supérieure (les doigts
//  s'y logent). Reproduit la forme du modèle SolidWorks.
//
//  Les rainures SUIVENT le bombé : leur profondeur est constante d'un bout
//  à l'autre (une simple saignée droite serait profonde au milieu et
//  inexistante aux extrémités).
//
//  ── UTILISATION ──────────────────────────────────────────────────────────
//  1. Ouvrir dans OpenSCAD (gratuit : openscad.org)
//  2. Régler les cotes ci-dessous — commencer par les 3 premières
//  3. F5 aperçu, F6 rendu, puis Fichier → Exporter → Exporter en STL
// ═══════════════════════════════════════════════════════════════════════════

/* [Cotes principales — À MESURER] */
longueur    = 160;   // longueur totale de la poignée
largeur     = 40;    // largeur
epaisseur   = 14;    // épaisseur au point le plus haut (au centre)

/* [Forme] */
bombe       = 6;     // flèche du bombé sur la longueur (0 = barre droite)
bout_r      = 18;    // rayon des extrémités arrondies
arete_r     = 2;     // adoucissement des arêtes latérales

/* [Rainures] */
nb_rainures = 3;     // nombre de rainures longitudinales
rainure_l   = 6;     // largeur d'une rainure
rainure_p   = 3;     // profondeur (constante sur toute la longueur)
rainure_ecart = 11;  // entraxe entre deux rainures
rainure_marge = 22;  // retrait des rainures par rapport aux extrémités

/* [Fixation] */
percer      = true;  // false = pas de trous (collage / double-face)
nb_vis      = 2;
entraxe     = 110;   // distance entre les centres des vis
vis_d       = 4.4;   // M4 = 4.4  ·  M5 = 5.4
tete_d      = 8.4;   // lamage pour la tête de vis
tete_h      = 4.5;   // profondeur du lamage

/* [Rendu] */
$fn = 72;
eps = 0.05;

// ═══════════════════════════════════════════════════════════════════════════

// Rayon du cylindre qui donne le bombé, pour une flèche = `bombe`
function rayon_bombe(l, f) = (l*l/4 + f*f) / (2*f);

module plaque_2d() {
    // Contour vu de dessus : rectangle à bouts arrondis
    hull()
        for (s = [-1, 1])
            translate([s * (longueur/2 - bout_r), 0]) circle(r = bout_r);
}

module barre_brute() {
    // Volume prismatique, arêtes latérales adoucies par minkowski
    minkowski() {
        linear_extrude(height = epaisseur - arete_r)
            offset(r = -arete_r) plaque_2d();
        sphere(r = arete_r);
    }
}

module corps(rabaisse = 0) {
    // La barre, dont le dessus est rogné par un grand cylindre : c'est lui
    // qui crée le bombé. `rabaisse` descend ce cylindre, ce qui sert à
    // fabriquer l'outil de rainurage qui épouse la surface.
    R = rayon_bombe(longueur, bombe);
    intersection() {
        barre_brute();
        translate([0, 0, epaisseur - R - rabaisse])
            rotate([90, 0, 0])
                cylinder(r = R, h = largeur * 4, center = true);
    }
}

module rainures() {
    // Fentes verticales traversantes, limitées à la peau du dessus par
    // intersection avec « ce qui dépasse du corps rabaissé ».
    dep = (nb_rainures - 1) * rainure_ecart / 2;
    intersection() {
        // les colonnes verticales, une par rainure
        union()
            for (i = [0 : nb_rainures - 1])
                translate([0, i * rainure_ecart - dep, 0])
                    hull()
                        for (s = [-1, 1])
                            translate([s * (longueur/2 - rainure_marge), 0, 0])
                                cylinder(d = rainure_l, h = epaisseur * 3);
        // la tranche de `rainure_p` sous la surface bombée
        difference() {
            translate([0, 0, -eps])
                linear_extrude(height = epaisseur * 3) plaque_2d();
            corps(rabaisse = rainure_p);
        }
    }
}

module percages() {
    dx = entraxe / 2;
    for (i = [0 : nb_vis - 1]) {
        x = (nb_vis == 1) ? 0 : -dx + i * (entraxe / (nb_vis - 1));
        translate([x, 0, -1]) cylinder(d = vis_d, h = epaisseur + 2);
        translate([x, 0, -eps]) cylinder(d = tete_d, h = tete_h);
    }
}

module poignee() {
    difference() {
        corps();
        rainures();
        if (percer) percages();
    }
}

poignee();

// ═══════════════════════════════════════════════════════════════════════════
//  IMPRESSION
//
//  ORIENTATION : face plate (le dessous) contre le plateau, rainures vers le
//    haut. Aucun support, et les couches sont perpendiculaires à l'effort
//    d'arrachement des vis — c'est le bon sens pour cette pièce.
//
//  MATÉRIAU : PETG ou ABS. Pas de PLA : un caisson monte à 40-50 °C et le PLA
//    flue (se déforme lentement sous charge) dès 50-55 °C.
//
//  RÉGLAGES : parois 4-5 · remplissage 40 % · couche 0.2
//
//  ⚠️ Vérifier `entraxe` et `vis_d` avant d'imprimer : ce sont les deux cotes
//     qui ne pardonnent pas si la porte est déjà percée.
// ═══════════════════════════════════════════════════════════════════════════
