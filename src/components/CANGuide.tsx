import React, { useState } from 'react';
import { PrinterConfig } from '../App';
import { Terminal, ChevronRight, CheckCircle2, AlertTriangle, Copy, Check, Wifi } from 'lucide-react';

interface Props {
  config: PrinterConfig;
  onChange: (p: Partial<PrinterConfig>) => void;
  onNext: () => void;
}

function CodeBlock({ code, label }: { code: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(code).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="rounded-lg border border-gray-700 bg-gray-950 overflow-hidden">
      {label && (
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-800 bg-gray-900">
          <span className="text-xs text-gray-500">{label}</span>
          <button onClick={copy} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors">
            {copied ? <Check size={11} className="text-green-400" /> : <Copy size={11} />}
            {copied ? 'Copié' : 'Copier'}
          </button>
        </div>
      )}
      <pre className="p-3 text-xs text-green-300 font-mono overflow-x-auto whitespace-pre leading-5">
        {code}
      </pre>
    </div>
  );
}

function Step({ n, title, status, children }: {
  n: number;
  title: string;
  status?: 'ok' | 'warn';
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-4">
      <div className="flex-shrink-0 flex flex-col items-center">
        <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm border-2
          ${status === 'ok' ? 'border-green-500 bg-green-900/30 text-green-400' : 'border-orange-500 bg-orange-900/20 text-orange-300'}`}>
          {status === 'ok' ? <CheckCircle2 size={16} /> : n}
        </div>
        <div className="flex-1 w-0.5 bg-gray-800 mt-2" />
      </div>
      <div className="pb-6 flex-1 min-w-0">
        <h3 className="text-sm font-semibold text-gray-200 mb-3">{title}</h3>
        <div className="space-y-3 text-sm text-gray-300">{children}</div>
      </div>
    </div>
  );
}

export function CANGuide({ config, onChange, onNext }: Props) {
  const speed = config.canSpeed;
  const speedK = speed === 500000 ? '500K' : '1M';

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white mb-1">Guide d'installation CAN Bus</h2>
        <p className="text-sm text-gray-400">
          BTT U2C v2.1 → EBB42 v1.2 → Cartographer CAN · {speed === 500000 ? '500 kbps' : '1 Mbps'} · Katapult + Klipper
        </p>
      </div>

      {/* Overview */}
      <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-5">
        <div className="flex items-center gap-2 mb-4">
          <Wifi size={15} className="text-orange-400" />
          <span className="text-xs font-bold text-gray-300 uppercase tracking-widest">Vue d'ensemble</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          {[
            {
              device: 'BTT U2C v2.1',
              role: 'Pont USB → CAN',
              firmware: 'Candlelight (pré-flashé d\'usine)',
              color: 'border-blue-800 bg-blue-900/20',
              badge: 'Plug & Play',
              badgeColor: 'text-green-400',
            },
            {
              device: 'BTT EBB42 v1.2',
              role: 'Toolhead board',
              firmware: 'Katapult + Klipper CAN',
              color: 'border-green-800 bg-green-900/20',
              badge: 'Flash requis',
              badgeColor: 'text-yellow-400',
            },
            {
              device: 'Cartographer CAN',
              role: 'Probe inductif',
              firmware: 'Firmware Cartographer (inclus)',
              color: 'border-orange-800 bg-orange-900/20',
              badge: 'UUID à noter',
              badgeColor: 'text-orange-400',
            },
          ].map(item => (
            <div key={item.device} className={`rounded-lg border p-3 ${item.color}`}>
              <div className="font-semibold text-gray-200 mb-1">{item.device}</div>
              <div className="text-gray-400 mb-1">{item.role}</div>
              <div className="text-gray-500 mb-2">{item.firmware}</div>
              <span className={`font-medium ${item.badgeColor}`}>{item.badge}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Steps */}
      <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-5 sm:p-6">
        <div className="flex items-center gap-2 mb-6">
          <Terminal size={15} className="text-orange-400" />
          <span className="text-xs font-bold text-gray-300 uppercase tracking-widest">Procédure complète</span>
        </div>

        <div className="space-y-0">
          {/* Step 1 */}
          <Step n={1} title="Câblage physique & résistances de terminaison">
            <div className="p-3 rounded-lg bg-yellow-900/20 border border-yellow-800 flex gap-2">
              <AlertTriangle size={13} className="text-yellow-400 flex-shrink-0 mt-0.5" />
              <div className="text-xs text-yellow-300">
                <strong>CRITIQUE :</strong> Résistances 120Ω UNIQUEMENT aux deux extrémités du bus CAN.
              </div>
            </div>
            <ul className="space-y-1.5 text-xs text-gray-400 mt-2">
              <li className="flex gap-2"><span className="text-green-400">✓</span> <strong>U2C v2.1</strong> : activer le jumper 120Ω (nœud terminal = extrémité 1)</li>
              <li className="flex gap-2"><span className="text-red-400">✗</span> <strong>EBB42</strong> : ne PAS mettre de résistance (nœud intermédiaire)</li>
              <li className="flex gap-2"><span className="text-green-400">✓</span> <strong>Cartographer</strong> : activer le jumper 120Ω (nœud terminal = extrémité 2)</li>
              <li className="flex gap-2"><span className="text-blue-400">→</span> Câble CAN : torsader CANH et CANL, câble blindé recommandé</li>
              <li className="flex gap-2"><span className="text-blue-400">→</span> Alimentation EBB42 : 24V séparé (ne pas alimenter uniquement via CAN)</li>
            </ul>
          </Step>

          {/* Step 2 */}
          <Step n={2} title="Configuration réseau CAN (Raspberry Pi)">
            <p className="text-xs text-gray-400">Connexion SSH au Pi puis création de l'interface can0 :</p>
            <CodeBlock
              label="Méthode 1 — systemd-networkd (recommandé MainsailOS récent)"
              code={`# Créer le fichier network
sudo nano /etc/systemd/network/can0.network

# Contenu du fichier :
[Match]
Name=can0

[CAN]
BitRate=${speedK}

# Activer systemd-networkd
sudo systemctl enable systemd-networkd
sudo systemctl start systemd-networkd
sudo reboot`}
            />
            <CodeBlock
              label="Méthode 2 — /etc/network/interfaces (anciens systèmes)"
              code={`sudo nano /etc/network/interfaces.d/can0

# Contenu :
auto can0
iface can0 can static
    bitrate ${speed}
    up ifconfig \\$IFACE txqueuelen 1024

sudo systemctl restart networking`}
            />
            <CodeBlock
              label="Vérification"
              code={`# Vérifier que can0 est actif
ip link show can0
# Attendu : can0: <NOARP,UP,LOWER_UP,ECHO> mtu 16 qdisc pfifo_fast state UP

# Vérifier la vitesse
ip -details link show can0 | grep bitrate`}
            />
          </Step>

          {/* Step 3 */}
          <Step n={3} title="Brancher le U2C — Vérification">
            <p className="text-xs text-gray-400">
              Le U2C v2.1 est livré avec le firmware Candlelight. Il n'y a rien à flasher dans la plupart des cas.
            </p>
            <CodeBlock
              label="Brancher U2C en USB puis vérifier"
              code={`# Vérifier que le U2C crée bien l'interface CAN
lsusb | grep -i "candlelight\\|gs_usb\\|U2C"
# Attendu : Bus 00X Device 00X: ID xxxx:xxxx ...

ip link show can0
# Doit être UP avec bitrate ${speed}`}
            />
            <div className="p-3 rounded-lg bg-blue-900/20 border border-blue-800 text-xs text-blue-300">
              Si <code className="bg-blue-900/30 px-1 rounded">can0</code> n'apparaît pas, le U2C peut nécessiter
              un reflash candlelight : <code className="bg-blue-900/30 px-1 rounded">sudo dfu-util -a 0 -D candlelight.bin --dfuse-address 0x08000000:force -d 0483:df11</code>
            </div>
          </Step>

          {/* Step 4 */}
          <Step n={4} title="Installer Katapult sur EBB42 v1.2">
            <p className="text-xs text-gray-400">Katapult est un bootloader qui permet de flasher Klipper via CAN sans câble USB à chaque mise à jour.</p>
            <CodeBlock
              label="Cloner et compiler Katapult"
              code={`cd ~
git clone https://github.com/Arksine/katapult
cd ~/katapult
make menuconfig

# Configuration menuconfig pour EBB42 v1.2 (STM32G0B1) :
# ┌─────────────────────────────────────────────────────────────┐
# │  Micro-controller Architecture: STMicroelectronics STM32    │
# │  Processor model: STM32G0B1                                  │
# │  Build Katapult deployment application: (8KiB bootloader)   │
# │  Clock Reference: 8 MHz crystal                              │
# │  Communication interface: CAN bus (on PB0/PB1)              │
# │  Application start offset: 8KiB offset                       │
# │  CAN bus speed: ${speed}                                  │
# │  GPIO pins to set on bootloader entry: PA10                  │
# └─────────────────────────────────────────────────────────────┘

make clean && make`}
            />
            <CodeBlock
              label="Flash Katapult sur EBB42 via USB (première fois)"
              code={`# Sur l'EBB42, installer le jumper 5V (alim via USB)
# Maintenir bouton BOOT enfoncé + appuyer RESET + relâcher RESET + relâcher BOOT

# Vérifier mode DFU
lsusb | grep "DFU\\|0483:df11"
# Attendu : ID 0483:df11 STMicroelectronics STM32 BOOTLOADER

# Flasher Katapult
sudo dfu-util -a 0 \\
  -D ~/katapult/out/katapult.bin \\
  --dfuse-address 0x08000000:force:mass-erase:leave \\
  -d 0483:df11

# Débrancher USB, retirer jumper 5V, rebrancher CAN 24V`}
            />
          </Step>

          {/* Step 5 */}
          <Step n={5} title="Flasher Klipper sur EBB42 via CAN">
            <CodeBlock
              label="Compiler Klipper pour EBB42 v1.2"
              code={`cd ~/klipper
make menuconfig

# Configuration menuconfig Klipper pour EBB42 v1.2 :
# ┌─────────────────────────────────────────────────────────────┐
# │  Micro-controller Architecture: STMicroelectronics STM32    │
# │  Processor model: STM32G0B1                                  │
# │  Bootloader offset: 8KiB bootloader                          │
# │  Clock Reference: 8 MHz crystal                              │
# │  Communication interface: CAN bus (on PB0/PB1)              │
# │  CAN bus speed: ${speed}                                  │
# └─────────────────────────────────────────────────────────────┘

make clean && make -j4`}
            />
            <CodeBlock
              label="Découverte UUID + flash Klipper"
              code={`# Scanner le CAN bus (EBB42 doit être en mode Katapult)
python3 ~/katapult/scripts/flashtool.py -i can0 -q
# Attendu : UUID: 11aa22bb33cc, Application: Katapult

# Flasher Klipper via CAN
python3 ~/katapult/scripts/flashtool.py \\
  -i can0 \\
  -f ~/klipper/out/klipper.bin \\
  -u 11aa22bb33cc    # ← remplacer par votre UUID

# Vérifier le flash
python3 ~/katapult/scripts/flashtool.py -i can0 -q
# Attendu : UUID: 11aa22bb33cc, Application: Klipper`}
            />
          </Step>

          {/* Step 6 */}
          <Step n={6} title="Découverte de tous les UUIDs CAN">
            <CodeBlock
              label="Scanner tous les appareils CAN (Klipper doit être arrêté)"
              code={`# Arrêter Klipper
sudo systemctl stop klipper

# Scanner le bus CAN
~/klippy-env/bin/python ~/klipper/scripts/canbus_query.py can0

# Résultat attendu avec EBB42 + Cartographer :
# Found canbus_uuid=11aa22bb33cc, Application: Klipper     ← EBB42
# Found canbus_uuid=44dd55ee66ff, Application: Cartographer ← Probe
# Total 2 uuids found

# Relancer Klipper
sudo systemctl start klipper`}
            />
            <div className="p-3 rounded-lg bg-green-900/20 border border-green-800 text-xs text-green-300">
              Notez les 2 UUIDs — ils sont à renseigner dans l'onglet <strong>Matériel & CAN</strong> et seront injectés automatiquement dans le <code className="bg-green-900/30 px-1 rounded">printer.cfg</code> généré.
            </div>
          </Step>

          {/* Step 7 */}
          <Step n={7} title="Mettre à jour le firmware EBB42 (futures mises à jour)">
            <p className="text-xs text-gray-400">Une fois Katapult installé, les updates Klipper se font entièrement via CAN — plus besoin du câble USB.</p>
            <CodeBlock
              label="Mise à jour Klipper sur EBB42 (via CAN)"
              code={`cd ~/klipper
git pull
make clean && make -j4

# Entrer en mode Katapult (si Klipper tourne déjà)
python3 ~/katapult/scripts/flashtool.py -i can0 -u ${config.ebb42Uuid || '11aa22bb33cc'} -r

# Flasher
python3 ~/katapult/scripts/flashtool.py \\
  -i can0 \\
  -f ~/klipper/out/klipper.bin \\
  -u ${config.ebb42Uuid || '11aa22bb33cc'}`}
            />
          </Step>
        </div>
      </div>

      {/* Troubleshooting */}
      <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-5">
        <h3 className="text-xs font-bold text-gray-300 uppercase tracking-widest mb-4">Dépannage fréquent</h3>
        <div className="space-y-3">
          {[
            {
              prob: 'can0 absent / not found',
              fix: 'Vérifier connexion USB U2C → Pi, relancer systemd-networkd ou networking',
            },
            {
              prob: 'Aucun UUID trouvé dans canbus_query.py',
              fix: 'Vérifier : alimentation 24V EBB42, résistances 120Ω, câbles CANH/CANL non inversés, firmware flashé',
            },
            {
              prob: 'Error sending command CONNECT lors du flash',
              fix: 'Débrancher tous les autres appareils CAN, ne laisser que l\'EBB42 en mode Katapult',
            },
            {
              prob: 'MCU timeout dans Klipper',
              fix: 'UUID incorrect dans printer.cfg, ou vitesse CAN différente entre firmware et config réseau',
            },
            {
              prob: 'Cartographer non détecté',
              fix: 'Vérifier alimentation 3.3V depuis EBB42, câbles CAN Cartographer, jumper 120Ω sur Cartographer',
            },
          ].map(item => (
            <div key={item.prob} className="flex gap-3 py-2 border-b border-gray-800 last:border-0">
              <div className="text-xs text-red-400 font-mono flex-shrink-0 w-52">{item.prob}</div>
              <div className="text-xs text-gray-400">{item.fix}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-end">
        <button
          onClick={onNext}
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-orange-600 hover:bg-orange-500 text-white font-medium text-sm transition-colors"
        >
          Configurer Cartographer <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}
