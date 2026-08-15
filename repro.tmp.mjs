import { chromium } from 'playwright';

const MOCK_CFG = `[include mainsail.cfg]
[mcu]
serial: /dev/serial/by-id/usb-Klipper_stm32f446xx_btt-octopus-pro-446-if00
[mcu toolhead]
canbus_interface: can0
canbus_uuid: 564fed93e397
[cartographer]
canbus_uuid: 4973681e12df
[stepper_z]
endstop_pin: probe:z_virtual_endstop
homing_retract_dist: 0
[extruder]
sensor_type: PT1000
[bed_mesh]
zero_reference_position: 200, 200
[gcode_macro START_PRINT]
gcode:
    G28
[gcode_macro END_PRINT]
gcode:
    M84
`;

const responses = {
  '/printer/info': { result: { state: 'ready', state_message: 'Printer is ready', hostname: 'ratos', software_version: 'v0.13.0-733-g0499b3037' } },
  '/printer/objects/query': { result: { status: {
    webhooks: { state: 'ready', state_message: 'Printer is ready' },
    mcu: { mcu_version: 'v0.12.0-268-g0844388d', last_stats: { bytes_retransmit: 0, mcu_awake: 0.01 } },
    'mcu toolhead': { mcu_version: 'v0.12.0-208-g49c0ad636', last_stats: { bytes_retransmit: 5, mcu_awake: 0.02, freq: 64000000 } },
    'mcu cartographer': { mcu_version: 'CARTOGRAPHER 2.2.0', last_stats: { bytes_retransmit: 0 } },
    extruder: { temperature: 28.1, target: 0, power: 0 },
    heater_bed: { temperature: 27.3, target: 0, power: 0 },
    'temperature_sensor Chamber': { temperature: 28.8 },
    toolhead: { homed_axes: '' },
    bed_mesh: { profile_name: '', probed_matrix: [] },
    print_stats: { state: 'standby' },
    cartographer: { temp: 27.7 },
    configfile: { config: {
      mcu: { serial: '/dev/serial/by-id/usb-Klipper_stm32f446xx_btt-octopus-pro-446-if00' },
      'mcu toolhead': { canbus_interface: 'can0', canbus_uuid: '564fed93e397' },
      cartographer: { canbus_uuid: '4973681e12df' },
      stepper_z: { endstop_pin: 'probe:z_virtual_endstop', homing_retract_dist: '0' },
      extruder: { sensor_type: 'PT1000' },
      bed_mesh: { zero_reference_position: '200, 200' },
    } },
  } } },
  '/server/gcode_store': { result: { gcode_store: [] } },
  '/machine/system_info': { result: { system_info: {
    canbus: { can0: { bitrate: 1000000, driver: 'gs_usb' } },
    usb_devices: [],
    cpu_info: { model_name: 'Cortex-A72' },
  } } },
  '/machine/proc_stats': { result: { system_cpu_usage: { cpu: 8 }, system_memory: { total: 1900000, available: 1500000 } } },
};

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
const page = await browser.newPage();

const pageErrors = [];
page.on('pageerror', e => pageErrors.push(e.stack ?? String(e)));
page.on('console', m => { if (m.type() === 'error') pageErrors.push('[console.error] ' + m.text()); });

await page.route(/192\.168\.1\.41/, async route => {
  const url = new URL(route.request().url());
  if (url.pathname === '/server/files/config/printer.cfg') {
    return route.fulfill({ status: 200, contentType: 'text/plain', body: MOCK_CFG });
  }
  const hit = Object.entries(responses).find(([p]) => url.pathname.startsWith(p));
  if (hit) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(hit[1]) });
  return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not mocked"}' });
});

await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
await page.getByRole('button', { name: /Diagnostic/i }).click();
await page.waitForTimeout(400);
await page.getByRole('button', { name: /Connecter/i }).click();
await page.waitForTimeout(2500);

const bodyText = (await page.textContent('body'))?.slice(0, 300);
console.log('=== PAGE ERRORS ===');
console.log(pageErrors.length ? pageErrors.join('\n---\n') : '(aucune)');
console.log('=== BODY (300c) ===');
console.log(bodyText);
await page.screenshot({ path: '/tmp/claude-0/-home-user-sb1-9dzehn3x/6059b037-8330-5df8-b65b-ae25eb246077/scratchpad/diag.png', fullPage: false });
await browser.close();
