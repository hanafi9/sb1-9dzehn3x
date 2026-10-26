"""Home Assistant (Assist) : faux serveur local au format de /api/conversation/process."""

import json
import os
import shutil
import ssl
import subprocess
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path[:0] = [ROOT, os.path.join(ROOT, "voice")]

from home_assistant import HomeAssistant  # noqa: E402


STATES = [
    {"entity_id": "media_player.tv_salon", "state": "off", "attributes": {"friendly_name": "TV Salon"}},
    {"entity_id": "remote.tv_salon", "state": "off", "attributes": {"friendly_name": "TV Salon"}},
    {"entity_id": "media_player.fire_tv_192_168_1_61", "state": "off", "attributes": {"friendly_name": "Fire TV"}},
    {"entity_id": "light.lustre", "state": "on", "attributes": {"friendly_name": "Lustre"}},
    {"entity_id": "script.denon_on", "state": "off", "attributes": {"friendly_name": "Denon ON"}},
    {"entity_id": "media_player.televiseur_du_salon", "state": "off", "attributes": {"friendly_name": "Téléviseur du salon"}},
    {"entity_id": "button.denon_tv_audio", "state": "unknown", "attributes": {"friendly_name": "Denon TV Audio"}},
    {"entity_id": "lock.porte_entree", "state": "locked", "attributes": {"friendly_name": "Porte d'entrée"}},
]


class FakeHA(BaseHTTPRequestHandler):
    requests = []

    def log_message(self, *a):
        pass

    def do_GET(self):
        one = [s for s in STATES if self.path == "/api/states/" + s["entity_id"]]
        out = json.dumps(one[0] if one else STATES).encode("utf-8")
        self.send_response(200 if self.headers["Authorization"] == "Bearer bon-jeton" else 401)
        self.send_header("Content-Length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        FakeHA.requests.append((self.path, self.headers["Authorization"], body))
        if self.path.startswith("/api/services/"):
            # la Fire TV obéit ; la télé du salon est en veille profonde et ne réagit pas
            for s in STATES:
                if s["entity_id"] == body.get("entity_id") and "fire_tv" in s["entity_id"]:
                    s["state"] = {"turn_on": "idle", "turn_off": "off"}.get(self.path.rsplit("/", 1)[1], s["state"])
                    if self.path.endswith("/select_source") and body.get("source", "").startswith("com."):
                        s.setdefault("attributes", {})["app_id"] = body["source"]
            self.send_response(200)
            self.send_header("Content-Length", "2")
            self.end_headers()
            self.wfile.write(b"[]")
            return
        if self.headers["Authorization"] != "Bearer bon-jeton":
            self.send_response(401)
            self.end_headers()
            return
        if "salon" in body["text"]:
            kind, speech = "action_done", "Lumière du salon allumée"
        elif "température" in body["text"]:
            kind, speech = "query_answer", "La température est de 21 degrés"
        else:
            kind, speech = "error", "Désolé, je ne connais pas d'appareil nommé garage"
        out = json.dumps({"conversation_id": "c1", "response": {
            "response_type": kind, "language": "fr", "speech": {"plain": {"speech": speech}}}}).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)


class HomeAssistantTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = HTTPServer(("127.0.0.1", 0), FakeHA)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.url = "http://127.0.0.1:%d/" % cls.server.server_port

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def setUp(self):
        FakeHA.requests.clear()

    def test_action_and_question(self):
        ha = HomeAssistant(self.url, token="bon-jeton")
        self.assertEqual(ha.ask("allume la lumière du salon"), (True, "Lumière du salon allumée"))
        path, auth, body = FakeHA.requests[0]
        self.assertEqual(path, "/api/conversation/process")
        self.assertEqual(body, {"text": "allume la lumière du salon", "language": "fr"})
        self.assertEqual(ha.ask("quelle est la température ?"), (True, "La température est de 21 degrés"))
        self.assertEqual(FakeHA.requests[1][2]["conversation_id"], "c1")    # même conversation

    def test_direct_find_and_control(self):
        ha = HomeAssistant(self.url, token="bon-jeton")
        ok, found = ha.find("fire tv")
        self.assertTrue(ok)
        self.assertEqual(found.splitlines()[0], "media_player.fire_tv_192_168_1_61 | Fire TV | off")
        ok, found = ha.find("TV salon")                           # deux appareils du même nom : les deux listés
        self.assertIn("media_player.tv_salon", found)
        self.assertIn("remote.tv_salon", found)
        self.assertNotIn("lock.porte_entree", ha.find("porte entrée")[1])   # serrure : jamais proposée
        ok, found = ha.find("télé du salon")                                 # télé = TV = Téléviseur
        self.assertTrue(found.startswith("media_player.televiseur_du_salon"))
        ok, found = ha.find("tv TCL")                                        # personne ne s'appelle TCL
        self.assertIn("ne correspond exactement", found)
        self.assertIn("Ne commande pas un autre appareil", found)
        self.assertIn("media_player.televiseur_du_salon", found)            # proposée, pas choisie
        self.assertIn("aucun appareil ne correspond exactement à « aquarium »", ha.find("aquarium")[1])
        ok, said = ha.control("media_player.fire_tv_192_168_1_61", "turn_on", sleep=lambda s: None)
        self.assertEqual((ok, said), (True, "fait : turn_on sur media_player.fire_tv_192_168_1_61 (état : idle)"))
        self.assertEqual(FakeHA.requests[-1][0], "/api/services/media_player/turn_on")
        self.assertEqual(FakeHA.requests[-1][2], {"entity_id": "media_player.fire_tv_192_168_1_61"})
        # ordre accepté par Home Assistant mais appareil muet : Kamil ne dit pas « c'est fait »
        ok, said = ha.control("media_player.tv_salon", "turn_on", wait_s=0.3, sleep=lambda s: None)
        self.assertFalse(ok)
        self.assertIn("n'a pas réagi (état : off)", said)
        ha.control("media_player.tv_salon", "volume_set", {"volume_level": 0.3})
        self.assertEqual(FakeHA.requests[-1][2], {"volume_level": 0.3, "entity_id": "media_player.tv_salon"})
        aliased = HomeAssistant(self.url, token="bon-jeton", app_aliases={
            "IPRO2": "com.iproboxx.iproboxxtviptvbox/.view.activity.SplashActivity"})
        ok, said = aliased.control("media_player.fire_tv_192_168_1_61", "select_source", {"source": "ipro 2"})
        self.assertEqual(FakeHA.requests[-1][0], "/api/services/androidtv/adb_command")   # lancement direct
        self.assertEqual(FakeHA.requests[-1][2]["command"],
                         "am start -n com.iproboxx.iproboxxtviptvbox/.view.activity.SplashActivity")
        self.assertEqual((ok, said), (True, "application com.iproboxx.iproboxxtviptvbox ouverte sur "
                                            "media_player.fire_tv_192_168_1_61"))
        aliased.app_aliases = {"ipro2": "com.iproboxx.iproboxxtviptvbox"}            # paquet seul
        aliased.control("media_player.fire_tv_192_168_1_61", "select_source", {"source": "IPRO2"})
        self.assertEqual(FakeHA.requests[-1][2]["command"],
                         "monkey -p com.iproboxx.iproboxxtviptvbox -c android.intent.category.LEANBACK_LAUNCHER 1")
        aliased.control("media_player.fire_tv_192_168_1_61", "select_source", {"source": "Netflix"})
        self.assertEqual(FakeHA.requests[-1][2]["source"], "Netflix")                           # inchangé
        self.assertEqual(aliased.app_alias("iProBox"), None)                    # trop différent d'« IPRO2 »
        aliased.app_aliases["iprobox"] = "com.iproboxx.iproboxxtviptvbox"
        self.assertEqual(aliased.app_alias("E-Pro Box"), "com.iproboxx.iproboxxtviptvbox")   # mal entendu
        remote = HomeAssistant(self.url, token="bon-jeton")                     # télécommande
        fire = "media_player.fire_tv_192_168_1_61"
        ok, said = remote.control(fire, "send_key", {"key": "bas", "repeat": 3})
        self.assertEqual(FakeHA.requests[-1][2]["command"],
                         "input keyevent KEYCODE_DPAD_DOWN KEYCODE_DPAD_DOWN KEYCODE_DPAD_DOWN")
        self.assertEqual((ok, said), (True, "touches bas ×3 sur " + fire))
        remote.control(fire, "send_key", {"key": "droite, OK", "repeat": ""})
        self.assertEqual(FakeHA.requests[-1][2]["command"], "input keyevent KEYCODE_DPAD_RIGHT KEYCODE_DPAD_CENTER")
        remote.control(fire, "send_key", {"key": "volume_plus dpad_up"})
        self.assertEqual(FakeHA.requests[-1][2]["command"], "input keyevent KEYCODE_VOLUME_UP KEYCODE_DPAD_UP")
        remote.control(fire, "send_key", {"key": "Retour"})
        self.assertEqual(FakeHA.requests[-1][2]["command"], "input keyevent KEYCODE_BACK")
        self.assertFalse(remote.control(fire, "send_key", {"key": "éjecter"})[0])      # touche inconnue
        remote.control(fire, "type_text", {"text": "le roi lion"})
        self.assertEqual(FakeHA.requests[-1][2]["command"], "input text 'le%sroi%slion'")
        self.assertFalse(remote.control("light.lustre", "send_key", {"key": "bas"})[0])  # pas une télé
        plain = HomeAssistant(self.url, token="bon-jeton")                      # sans nom d'application connu :
        ok, said = plain.control("media_player.fire_tv_192_168_1_61", "select_source",
                                 {"source": "com.iproboxx.iproboxxtviptvbox"}, sleep=lambda s: None)
        self.assertTrue(ok)                                                     # select_source, vérifié
        ok, said = plain.control("media_player.fire_tv_192_168_1_61", "select_source", {"source": "Inconnue"},
                                   wait_s=0.3, sleep=lambda s: None)
        self.assertFalse(ok)                                                    # Kamil ne dit pas « fait »
        self.assertIn("n'a pas ouvert « Inconnue »", said)
        ok, said = remote.control("script.denon_on", "turn_on", wait_s=0.3, sleep=lambda s: None)
        self.assertTrue(ok)                    # script infrarouge : redevient « off » aussitôt, c'est normal
        n = len(FakeHA.requests)
        self.assertFalse(ha.control("lock.porte_entree", "unlock")[0])            # domaine interdit
        self.assertFalse(ha.control("light.lustre", "delete_everything")[0])      # service inconnu
        self.assertEqual(len(FakeHA.requests), n)                                # rien d'envoyé

    def test_errors(self):
        ok, msg = HomeAssistant(self.url, token="bon-jeton").ask("ouvre le garage")
        self.assertFalse(ok)
        self.assertIn("garage", msg)
        ok, msg = HomeAssistant(self.url, token="faux").ask("allume le salon")
        self.assertEqual((ok, "401" in msg), (False, True))
        ok, msg = HomeAssistant("http://127.0.0.1:9", token="bon-jeton", timeout=1).ask("allume")
        self.assertEqual((ok, "injoignable" in msg), (False, True))
        os.environ.pop("HOME_ASSISTANT_TOKEN", None)
        ok, msg = HomeAssistant(self.url).ask("allume")
        self.assertEqual((ok, "jeton" in msg), (False, True))


@unittest.skipIf(shutil.which("openssl") is None, "openssl absent")
class SelfSignedHttpsTest(unittest.TestCase):
    """Home Assistant en https avec un certificat auto-signé, comme sur le réseau local."""

    @classmethod
    def setUpClass(cls):
        d = tempfile.mkdtemp()
        cls.cert, key = os.path.join(d, "cert.pem"), os.path.join(d, "key.pem")
        subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj",
                        "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1", "-keyout", key, "-out", cls.cert],
                       check=True, capture_output=True)
        cls.server = HTTPServer(("127.0.0.1", 0), FakeHA)
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(cls.cert, key)
        cls.server.socket = ctx.wrap_socket(cls.server.socket, server_side=True)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.url = "https://127.0.0.1:%d" % cls.server.server_port

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def test_refused_by_default_then_accepted(self):
        ok, msg = HomeAssistant(self.url, token="bon-jeton", timeout=3).ask("allume le salon")
        self.assertFalse(ok)                                   # certificat inconnu : refusé
        ok, msg = HomeAssistant(self.url, token="bon-jeton", verify_ssl=False).ask("allume le salon")
        self.assertEqual((ok, msg), (True, "Lumière du salon allumée"))
        ok, msg = HomeAssistant(self.url, token="bon-jeton", ca_file=self.cert).ask("allume le salon")
        self.assertTrue(ok)                                    # certificat fourni : vérifié


if __name__ == "__main__":
    unittest.main()
