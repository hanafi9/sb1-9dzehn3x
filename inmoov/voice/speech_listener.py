#!/usr/bin/env python3
"""Reconnaissance vocale améliorée pour InMoov (hors ligne, en français).

Chaîne : micro -> détection de voix (WebRTC VAD) -> Whisper (faster-whisper)
         -> mot de réveil -> commande locale
                          OU IA Claude (si "brain.enabled", voir llm_brain.py)
                          OU IA locale (si "local_llm.enabled", voir llm_local.py)
                          OU chatbot MyRobotLab (i01.chatBot) en dernier recours
Voix : MyRobotLab (i01.mouth) ou Piper hors ligne ("voice.tts": "piper").

La réponse du chatbot est prononcée par MyRobotLab lui-même
(chatBot -> htmlFilter -> mouth, câblage standard d'InMoov2) ;
celle de Claude est envoyée à i01.mouth.speak.

    python speech_listener.py --config ../config.json
    python speech_listener.py --list-devices
"""

import argparse
import json
import logging
import os
import queue
import random
import sys
import threading
import time

import numpy as np
import sounddevice as sd
import webrtcvad
from faster_whisper import WhisperModel

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from audio_gain import amplify_pcm16, normalize_peak  # noqa: E402
from mrl_client import MrlClient, load_config  # noqa: E402
from segmenter import UtteranceSegmenter  # noqa: E402
from text_utils import (clean_chatbot_reply, find_wake_word_anywhere, is_hallucination,  # noqa: E402
                        match_command, strip_wake_word)

log = logging.getLogger("voice")

SAMPLE_RATE = 16000  # Whisper et WebRTC VAD travaillent en 16 kHz
FRAME_MS = 30
WAKE_REPLIES = ["Oui ?", "Je t'écoute !", "Présent !", "Oui, chef ?", "Hmm ?", "Me voilà !", "Oui, oui ?"]
# humour 3 (farceur)
WAKE_REPLIES_FUNNY = ["Présent, chef ! Batteries chargées !", "Kamil à l'écoute, antennes déployées !",
                      "Oui ? J'étais en train de compter mes vis.", "Me voilà ! Je ne dormais pas, promis.",
                      "Bip bip, je t'écoute !", "Oui, mon capitaine ?", "Tu m'as appelé ? Mes oreilles frétillent !"]
WAKE_REPLIES_ADO = ["Yo ! Je suis là !", "Ouais ? Vas-y, je t'écoute !", "Wesh, c'est Kamil, quoi de neuf ?",
                    "Présent ! Trop prêt !", "Oui oui, j'suis grave réveillé !", "Ah, te voilà ! Raconte !",
                    "Tranquille, je t'écoute !"]
FRAME_SAMPLES = SAMPLE_RATE * FRAME_MS // 1000


# couleurs des LED d'état (NeoPixel d'InMoov2)
LED_COLORS = {
    "idle": (0, 0, 20),
    "awake": (0, 80, 255),
    "thinking": (120, 0, 200),
    "speaking": (0, 200, 60),
    "error": (255, 0, 0),
}


class Listener:
    def __init__(self, cfg, mrl, dry_run=False, brain_cfg=None, local_cfg=None, leds_cfg=None, mqtt_cfg=None):
        self.cfg = cfg
        self.brain_cfg = brain_cfg or {}
        self.mrl = mrl
        self.dry_run = dry_run
        self.leds = leds_cfg if leds_cfg and leds_cfg.get("enabled") else None
        self.tts = None
        self.pipeline = None
        if cfg.get("tts") == "piper":
            from tts_piper import PiperSpeaker, SpeechPipeline  # importé seulement si utilisé

            self.tts = PiperSpeaker(cfg["piper_model"], length_scale=cfg.get("piper_length_scale"),
                                    speaker_id=cfg.get("piper_speaker_id"))
            if (cfg.get("cloud_tts") or {}).get("enabled"):
                from tts_cloud import CloudSpeaker

                # voix en ligne plus naturelle ; Piper reste là si Internet manque
                self.tts = CloudSpeaker(cfg["cloud_tts"], fallback=self.tts)
                log.info("Voix en ligne : %s, voix « %s » (Piper en secours)", self.tts.model, self.tts.voice)
            if not dry_run:
                # phrase par phrase : le robot parle pendant que Claude écrit la suite
                self.pipeline = SpeechPipeline(self.tts, fallback=self._speak_mrl)
                self.pipeline.on_play_start = self._on_play_start
                self.pipeline.on_audio = self._on_sound_file
                self.pipeline.on_idle = self._on_speech_done
            log.info("Voix hors ligne Piper : %s", cfg["piper_model"])
            from reasoning import FILLERS, THINKING_PHRASES

            self.brain_cfg = brain_cfg
            self.tts.warm_up(list(cfg.get("wake_replies") or self._default_wake_replies())
                             + FILLERS + THINKING_PHRASES)
        self.memory = None
        self.brain = None
        self.reactions = None
        self.voices = None
        self._last_audio = None
        spk = cfg.get("speaker_id") or {}
        if spk.get("enabled"):
            from speaker_id import MODEL_NAME, VoiceIdentifier, make_extractor

            try:
                self.voices = VoiceIdentifier(make_extractor(spk.get("model") or "models/" + MODEL_NAME),
                                              spk.get("db_path") or "data/voices.json",
                                              threshold=float(spk.get("threshold", 0.55)))
                log.info("Reconnaissance des voix : %s", ", ".join(self.voices.names()) or "aucune voix enregistrée")
            except Exception as e:  # sans elle, le robot parle quand même
                log.warning("Reconnaissance des voix désactivée : %s", e)
        if brain_cfg and brain_cfg.get("enabled"):
            from llm_brain import ClaudeBrain  # importé seulement si utilisé

            if brain_cfg.get("memory_path"):
                from memory_store import MemoryStore

                self.memory = MemoryStore(brain_cfg["memory_path"])
            self.mind = None
            mind_cfg = brain_cfg.get("mind") or {}
            if mind_cfg.get("enabled"):
                from mind import Mind

                self.mind = Mind(mind_cfg)
                self.mind.start(mind_cfg.get("period_s", 2.0))   # étudie la pièce en continu (Coral)
                log.info("Perception, humeur et souvenirs des conversations : activés")
            self.brain = ClaudeBrain(brain_cfg, self._call_checked, self.say, memory=self.memory, mind=self.mind,
                                     say_async=self.say_async if self.pipeline else None,
                                     wait_speech=self.wait_speech if self.pipeline else None)
            log.info("IA conversationnelle : Claude (%s)", brain_cfg["model"])
            spk = cfg.get("speaker_id") or {}
            if spk.get("owner") and spk.get("owner_only_tools"):
                # mouvements réservés à une voix (ex. move_head, hand, gesture)
                self.brain.owner = spk["owner"]
                self.brain.restricted_tools = set(spk["owner_only_tools"])
            watch_cfg = brain_cfg.get("watch") or {}
            if watch_cfg.get("enabled") and mind_cfg.get("vision_state_path"):
                from watch import Watcher

                self.watcher = Watcher(watch_cfg, mind_cfg["vision_state_path"])
                self.brain.watcher = self.watcher
                log.info("Surveillance : journal %s, photos %s", self.watcher.journal_path, self.watcher.snap_dir)
            react_cfg = brain_cfg.get("reactions") or {}
            if react_cfg.get("enabled") and mind_cfg.get("vision_state_path"):
                from reactions import Reactions

                self.reactions = Reactions(react_cfg, mind_cfg["vision_state_path"],
                                           environment=self.mind.environment if self.mind else None)
                log.info("Réactions spontanées à ce que voient les caméras : %s", ", ".join(self.reactions.cfg["events"]))
        self.local = None
        if local_cfg and local_cfg.get("enabled"):
            from llm_local import LocalBrain

            self.local = LocalBrain(local_cfg, (brain_cfg or {}).get("robot_name", "InMoov"))
            log.info("IA de secours : %s", self.local.name())
            if self.brain is not None:
                self.brain.has_backup = True                         # crédit épuisé : elle prend le relais
                self.local.home = getattr(self.brain, "home", None)  # et garde la main sur la maison
        self.vad = webrtcvad.Vad(cfg["vad_aggressiveness"])
        self.segmenter = UtteranceSegmenter(
            frame_ms=FRAME_MS,
            padding_ms=cfg["padding_ms"],
            end_silence_ms=cfg["end_silence_ms"],
            start_speech_ratio=cfg["start_speech_ratio"],
            min_utterance_ms=cfg["min_utterance_ms"],
            max_utterance_s=cfg["max_utterance_s"],
        )
        log.info("Chargement de Whisper « %s » (%s)...", cfg["whisper_model"], cfg["whisper_compute_type"])
        self.model = WhisperModel(
            cfg["whisper_model"],
            device="cpu",
            compute_type=cfg["whisper_compute_type"],
            cpu_threads=cfg["whisper_threads"],
        )
        # 1er calcul de Whisper toujours lent (mise en route) : fait ici, pas sur la 1re phrase
        t0 = time.monotonic()
        list(self.model.transcribe(np.zeros(SAMPLE_RATE, dtype=np.float32), language=cfg["language"], beam_size=1,
                                   without_timestamps=True, vad_filter=False)[0])
        log.info("Whisper prêt (mise en route %.1f s)", time.monotonic() - t0)
        self.cloud = None
        self.screen_model = None
        if (cfg.get("cloud_stt") or {}).get("enabled"):
            from cloud_stt import CloudTranscriber

            self.cloud = CloudTranscriber(cfg["cloud_stt"])
            log.info("Reconnaissance vocale en ligne : %s (%s), Whisper du Pi en secours",
                     cfg["cloud_stt"].get("provider", "groq"), self.cloud.model)
            screen = cfg["cloud_stt"].get("screen_model")
            if cfg["cloud_stt"].get("save_quota") and screen and screen != cfg["whisper_model"]:
                # petit modèle juste pour repérer « Kamil » (ex. tiny : ~4 fois plus rapide que base)
                self.screen_model = WhisperModel(screen, device="cpu", compute_type=cfg["whisper_compute_type"],
                                                 cpu_threads=cfg["whisper_threads"])
                list(self.screen_model.transcribe(np.zeros(SAMPLE_RATE, dtype=np.float32), language=cfg["language"],
                                                  beam_size=1, without_timestamps=True, vad_filter=False)[0])
                log.info("Repérage de « Kamil » avec Whisper « %s »", screen)
        self.fallback_model = None
        if cfg.get("whisper_fallback_model"):
            # 2e modèle plus juste (mais ~3 fois plus lent), utilisé seulement quand le 1er hésite
            log.info("Chargement de Whisper « %s » (si le 1er n'est pas sûr de lui)...", cfg["whisper_fallback_model"])
            self.fallback_model = WhisperModel(cfg["whisper_fallback_model"], device="cpu",
                                               compute_type=cfg["whisper_compute_type"],
                                               cpu_threads=cfg["whisper_threads"])
        self.frames = queue.Queue()
        self.awake_until = 0.0
        self.mute_until = 0.0
        self.ha = None
        self._start_bridges(cfg.get("app_bridge") or {}, mqtt_cfg or {}, (brain_cfg or {}).get("mind") or {})

    def _start_bridges(self, bridge_cfg, mqtt_cfg, mind_cfg):
        """L'onglet Kamil de l'Atelier (kamil_bridge.py) et Home Assistant (ha_mqtt.py) : état de Kamil,
        conversation, « dis… », questions écrites, mode garde."""
        from kamil_bridge import Bridges, LocalBridge

        self.ha = Bridges()
        if bridge_cfg.get("enabled", True):
            self.ha.add(LocalBridge(bridge_cfg))
        mqtt = None
        if mqtt_cfg.get("enabled"):
            try:
                from ha_mqtt import KamilMQTT

                mqtt = self.ha.add(KamilMQTT(mqtt_cfg, mind_cfg.get("vision_state_path")))
            except Exception as e:   # ex. paho-mqtt non installé : Kamil marche sans
                log.warning("Home Assistant (MQTT) désactivé : %s", e)
        watcher = getattr(self, "watcher", None)
        if watcher is not None:
            self.ha.set_guard_state(lambda: watcher.guard)
            watcher.on_record = lambda entry: (self.ha.publish("journal", entry["text"]),
                                               self.ha.guard(watcher.guard))
        self.ha.state("idle")
        if mqtt is not None:
            mqtt.start()

    # --- audio -------------------------------------------------------------
    def _on_audio(self, indata, n_frames, time_info, status):
        if status:
            log.debug("audio: %s", status)
        self.frames.put(bytes(indata))

    def _flush_audio(self):
        while not self.frames.empty():
            try:
                self.frames.get_nowait()
            except queue.Empty:
                break
        self.segmenter.reset()

    # --- reconnaissance ----------------------------------------------------
    def transcribe(self, pcm16):
        audio = np.frombuffer(pcm16, dtype=np.int16).astype(np.float32) / 32768.0
        if self.cfg.get("auto_gain", True):
            # micro trop faible : la phrase est remontée à un bon niveau avant Whisper
            audio = normalize_peak(audio, max_gain=self.cfg.get("auto_gain_max", 20.0))
        self._last_audio = audio   # pour reconnaître la voix si la phrase s'adresse au robot
        local = None
        if getattr(self, "cloud", None) is not None:
            from cloud_stt import CloudError

            if (self.cfg.get("cloud_stt") or {}).get("save_quota") and time.monotonic() >= self.awake_until:
                # télé allumée toute la journée : le Pi écoute d'abord, et seules les phrases
                # avec « Kamil » partent en ligne (le quota gratuit de Groq est de 2000 phrases/jour)
                # ce texte sert seulement à repérer « Kamil » : recherche simple (beam 1), 1,5 à 2 fois plus rapide
                t0 = time.monotonic()
                local = self._whisper(getattr(self, "screen_model", None) or self.model, audio,
                                      (self.cfg.get("cloud_stt") or {}).get("screen_beam_size", 1))
                log.info("(repérage du mot de réveil sur le Pi : %.1f s pour %.1f s de son)",
                         time.monotonic() - t0, len(audio) / float(SAMPLE_RATE))
                heard = (local[0] + " " + local[2]).strip()
                if not (strip_wake_word(heard, self.cfg["wake_words"])[0]
                        or find_wake_word_anywhere(heard, self.cfg["wake_words"], threshold=0.75) is not None):
                    return local[0]
            try:
                return self.cloud.transcribe(audio)
            except CloudError as e:
                log.warning("Reconnaissance en ligne impossible (%s) : Whisper du Pi", e)
                if getattr(self, "screen_model", None) is not None:
                    local = None    # le texte du petit modèle de repérage n'est pas assez juste pour répondre
        text, confidence, doubtful = local or self._whisper(self.model, audio, self.cfg["beam_size"])
        threshold = self.cfg.get("fallback_below_confidence", -0.45)
        # le 2e modèle ne sert que pour une phrase adressée au robot (mot de réveil, ou conversation
        # en cours) : inutile de perdre 5 s sur un bruit ou une discussion qui ne le concerne pas
        heard = (text + " " + doubtful).strip()   # y compris ce que le 1er modèle a jugé trop incertain
        for_robot = time.monotonic() < self.awake_until or strip_wake_word(heard, self.cfg["wake_words"])[0]
        if (self.fallback_model is not None and for_robot and not is_hallucination(heard)
                and (doubtful or (text and confidence < threshold))):
            t0 = time.monotonic()
            better, conf2, _ = self._whisper(self.fallback_model, audio, self.cfg.get("fallback_beam_size", 1))
            log.info("1er modèle pas sûr (%.2f) : « %s » → 2e modèle (%.1f s, %.2f) : « %s »",
                     confidence, text, time.monotonic() - t0, conf2, better)
            if better:
                text = better
        return text

    def _whisper(self, model, audio, beam_size):
        """Renvoie (texte, confiance moyenne, texte écarté car trop incertain) ;
        confiance = log-probabilité moyenne, 0 = certain, -1 = très incertain."""
        segments, _ = model.transcribe(
            audio,
            language=self.cfg["language"],
            beam_size=beam_size,
            initial_prompt=self.cfg.get("vocabulary") or None,
            condition_on_previous_text=False,
            # un seul essai : les nouveaux essais « à température » de Whisper sur du bruit
            # prenaient jusqu'à 55 s, pendant lesquelles le robot n'entendait plus rien
            temperature=self.cfg.get("temperature", 0.0),
            # au plus ~8 mots-morceaux par seconde d'audio : sur du bruit, Whisper peut
            # « inventer » des centaines de mots et bloquer l'écoute de longues secondes
            max_new_tokens=min(self.cfg.get("max_new_tokens", 128), 16 + int(8 * len(audio) / SAMPLE_RATE)),
            without_timestamps=True,
            vad_filter=False,  # déjà fait par WebRTC VAD
        )
        parts, weighted, total, doubtful = [], 0.0, 0, ""
        for seg in segments:
            if seg.no_speech_prob > self.cfg["max_no_speech_prob"]:
                log.debug("ignoré (no_speech %.2f) : %s", seg.no_speech_prob, seg.text)
                continue
            if seg.avg_logprob < self.cfg["min_avg_logprob"]:
                log.debug("ignoré (confiance %.2f) : %s", seg.avg_logprob, seg.text)
                doubtful += " " + seg.text.strip()   # de la parole, mais incompréhensible pour ce modèle
                continue
            parts.append(seg.text.strip())
            n = max(1, len(seg.text))
            weighted += seg.avg_logprob * n
            total += n
        return " ".join(parts).strip(), (weighted / total if total else 0.0), doubtful.strip()

    # --- actions -----------------------------------------------------------
    def _call(self, service, method, *params):
        return self._call_checked(service, method, *params)[1]

    def _call_checked(self, service, method, *params):
        log.info("-> %s.%s%s", service, method, params)
        if self.dry_run:
            return True, None
        return self.mrl.call_checked(service, method, *params)

    def say(self, text):
        if self.pipeline is None:
            self.status("speaking")
        else:
            # même file que les phrases de Claude : jamais deux sons en même temps
            turn = getattr(self, "turn", None)
            if turn and "queued" not in turn:
                turn["queued"] = time.monotonic()
            self.pipeline.put(text)
            self.wait_speech()
            return
        if self.tts is not None and not self.dry_run:
            try:
                self.tts.speak(text)  # bloquant : le micro est ignoré pendant ce temps
                self.mute_until = time.monotonic() + 0.3
                return
            except Exception:
                log.exception("Voix Piper en échec, on utilise la voix de MyRobotLab")
        self._speak_mrl(text)

    def _speak_mrl(self, text):
        log.info("🔊 MyRobotLab (%s) : %s", self.cfg["mouth_service"], (text or "")[:60])
        self._call(self.cfg["mouth_service"], "speak", text)
        self._mute_for(text)

    def say_async(self, text):
        """Phrase mise dans la file de Piper : rend la main tout de suite."""
        turn = getattr(self, "turn", None)
        if turn and "queued" not in turn:
            turn["queued"] = time.monotonic()
        # « je parle » ne s'affiche qu'au moment où le son sort vraiment (_on_play_start) :
        # la voix en ligne met une ou deux secondes à arriver, l'animation partait trop tôt
        self.pipeline.put(text)

    def _on_sound_file(self, path, duration):
        """Phrase sur le point d'être jouée : sa courbe de volume fait bouger la bouche dans l'Atelier."""
        if getattr(self, "ha", None) is None:
            return
        from mouth_sync import FRAME_MS, envelope

        # la courbe part d'abord, le son un peu après : l'écran l'a reçue avant le premier mot
        # (sinon la bouche démarre en retard) ; aplay met encore quelques dizaines de ms à sortir le son
        lead = max(0.0, self.cfg.get("mouth_lead_ms", 120) / 1000.0)
        self.ha.mouth(envelope(path), FRAME_MS, time.time() + lead + self.cfg.get("mouth_latency_ms", 60) / 1000.0)
        if lead:
            time.sleep(lead)

    def _on_play_start(self, text):
        """Une phrase commence à sonner : l'état « je parle » (visage, bouche, LED) suit le vrai son."""
        self._playing = True
        self._show_state()
        self._on_first_sound(text)

    def _on_speech_done(self):
        """Plus rien dans la file de parole : retour à l'état réel (écoute, réflexion…)."""
        self._playing = False
        self._show_state()

    def _on_first_sound(self, text):
        """Journal du délai de réponse, décomposé, pour voir quelle étape est lente."""
        turn, self.turn = getattr(self, "turn", None), None
        now = time.monotonic()
        if not turn or "queued" not in turn or now - turn["end"] > 30:   # vieille phrase ignorée
            return
        steps = {"total": now - turn["end"], "silence": self.cfg["end_silence_ms"] / 1000.0,
                 "ecoute": turn["whisper"], "ia": turn["queued"] - turn["heard"], "voix": now - turn["queued"]}
        # reconnaissance = Whisper du Pi et/ou en ligne ; voix = Piper ou voix en ligne (fichier téléchargé)
        log.info("⏱ 1er son %.1f s après la fin de ta phrase = silence de fin %.1f + reconnaissance %.1f "
                 "+ IA (1re phrase) %.1f + voix %.1f  [« %s »]",
                 steps["total"], steps["silence"], steps["ecoute"], steps["ia"], steps["voix"], text[:40])
        if getattr(self, "ha", None) is not None:   # affiché dans l'onglet Kamil de l'Atelier
            self.ha.publish("delai", json.dumps({k: round(v, 1) for k, v in steps.items()}))

    def wait_speech(self):
        """Attend la fin de tout ce qui est dans la file de Piper."""
        self.pipeline.wait()
        self.mute_until = max(self.mute_until, time.monotonic() + 0.3)

    def status(self, state):
        """Couleur des LED d'état (facultatif, service NeoPixel d'InMoov2) et état dans Home Assistant.
        Tant qu'une phrase sonne, c'est « je parle » qui s'affiche ; l'état demandé reprend ensuite."""
        self._state = state
        self._show_state()

    def _show_state(self):
        state = "speaking" if getattr(self, "_playing", False) else getattr(self, "_state", "idle")
        if state == getattr(self, "_shown", None):
            return
        self._shown = state
        if getattr(self, "ha", None) is not None:
            self.ha.state(state)
        if self.leds is None:
            return
        r, g, b = self.leds.get("colors", {}).get(state, LED_COLORS[state])
        self._call_checked(self.leds["service"], "fill", r, g, b)

    def _funny(self):
        brain_cfg = getattr(self, "brain_cfg", None) or {}
        return int((brain_cfg.get("personality") or {}).get("humour", 2)) >= 3

    def _default_wake_replies(self):
        brain_cfg = getattr(self, "brain_cfg", None) or {}
        if (brain_cfg.get("personality") or {}).get("style") == "ado":
            return WAKE_REPLIES_ADO
        return WAKE_REPLIES_FUNNY if self._funny() else WAKE_REPLIES

    def _wake_reply(self):
        """Réponse immédiate à « Kamil ! » seul, variée pour ne pas sonner comme une machine."""
        replies = self.cfg.get("wake_replies") or self._default_wake_replies()
        last = getattr(self, "_last_wake_reply", None)
        reply = random.choice([r for r in replies if r != last] or replies)
        self._last_wake_reply = reply
        return reply

    def _mute_for(self, text):
        # Le micro entendrait la voix du robot : on l'ignore le temps qu'il parle.
        if text:
            self.mute_until = time.monotonic() + 0.5 + len(text) * self.cfg["seconds_per_char"]

    def _show_heard(self, text):
        if getattr(self, "ha", None) is not None and text:
            self.ha.publish("entendu", text)

    def handle(self, text, addressed=False):
        """addressed : phrase forcément pour Kamil (ex. question écrite dans Home Assistant)."""
        now = time.monotonic()
        awake = now < self.awake_until
        # le mot de réveil est retiré même si le robot est déjà réveillé (« Kamil… » puis « Kamil, … »)
        found, rest = (True, text) if addressed else strip_wake_word(text, self.cfg["wake_words"])
        if not found and self.cfg["wake_words"]:
            # avec la télé allumée, la phrase dure jusqu'à 12 s : « Kamil » peut être au milieu
            after = find_wake_word_anywhere(text, self.cfg["wake_words"])
            if after is not None:
                log.info("(« %s » entendu au milieu de la phrase : on garde la suite)", self.cfg["wake_words"][0])
                found, rest = True, after
        if not awake and not found:
            log.info("(pas de mot de réveil) %s", text)
            return
        heard = text
        if found:
            if not rest:
                self._show_heard(heard)
                self.awake_until = now + self.cfg["wake_window_s"]
                self.say(self._wake_reply())
                self.status("awake")
                return
            text = rest
        self.awake_until = 0.0
        speaker = self._identify()
        if not found and self._background(speaker):
            return
        # dans la conversation (Atelier, Home Assistant) : seulement les phrases pour Kamil, pas la télé
        self._show_heard(heard)
        if self.reactions is not None:
            self.reactions.on_conversation()

        phrase, actions = match_command(text, self.cfg["commands"], self.cfg["fuzzy_threshold"])
        if actions:
            log.info("Commande : %s", phrase)
            owner = (self.cfg.get("speaker_id") or {}).get("owner")
            if owner and (self.cfg.get("speaker_id") or {}).get("owner_only_commands") and speaker != owner:
                log.info("Commande refusée : voix de %s non reconnue", owner)
                self.say("Désolé, je n'obéis à cet ordre que si je reconnais la voix de %s." % owner)
                return
            for action in actions:
                self._call(*action)
            return

        self.status("thinking")
        answered, said = False, None
        try:
            if self.brain is not None:
                try:
                    said = self.brain.ask(text, speaker=speaker, direct=found)
                    answered = said is not None
                except Exception:  # ex. clé API absente : le robot doit continuer d'écouter
                    log.exception("Erreur inattendue de l'IA")
                    self.brain.reset()
                if said == "":
                    return          # Claude a jugé que ce n'était pas pour lui : silence, sans relance
                if said and getattr(self, "ha", None) is not None:
                    self.ha.publish("reponse", said)
                if not answered:
                    log.warning("Claude indisponible")

            if not answered and self.local is not None:
                reply = self.local.ask(text)
                if reply:
                    log.info("Réponse de l'IA locale : %s", reply)
                    if getattr(self, "ha", None) is not None:
                        self.ha.publish("reponse", reply)
                    self.say(reply)
                    answered = True
                else:
                    log.warning("IA locale indisponible")
        finally:
            self.status("idle")
        if answered:
            self._follow_up(question=isinstance(said, str) and said.rstrip().endswith("?"))
            return

        if not self.cfg.get("chatbot_fallback", True):
            log.warning("Pas de réponse (chatbot d'InMoov2 désactivé)")
            self.say("Désolé, mon cerveau ne répond pas pour l'instant.")
            return
        log.warning("On utilise le chatbot d'InMoov2")

        resp = self._call(self.cfg["chatbot_service"], self.cfg["chatbot_method"], text)
        reply = clean_chatbot_reply(resp.get("msg")) if isinstance(resp, dict) else None
        log.info("Réponse du chatbot : %s", reply)
        if reply and self.tts is not None and not self.dry_run:
            # avec Piper, la réponse sort par les haut-parleurs du robot comme celle de Claude
            # (la voix de MyRobotLab peut être muette ou envoyée vers le HDMI)
            self.say(reply)
        else:
            self._mute_for(reply)
        if reply:
            self._follow_up()

    def _follow_up(self, question=False):
        """Après une réponse, on peut continuer sans redire le mot de réveil pendant quelques secondes
        (plus longtemps si le robot vient de poser une question : on a le temps de réfléchir)."""
        window = self.cfg.get("follow_up_question_s", 25) if question else self.cfg.get("follow_up_s", 15)
        if window > 0:
            self.awake_until = max(time.monotonic(), self.mute_until) + window
            self.status("awake")

    # --- boucle principale -------------------------------------------------
    def run(self):
        with sd.RawInputStream(
            samplerate=SAMPLE_RATE,
            blocksize=FRAME_SAMPLES,
            dtype="int16",
            channels=1,
            device=self.cfg.get("input_device"),
            callback=self._on_audio,
        ):
            log.info("À l'écoute. Dites « %s » puis votre phrase.", " / ".join(self.cfg["wake_words"]) or "...")
            while True:
                frame = self.frames.get()
                if len(frame) != FRAME_SAMPLES * 2:
                    continue
                frame = amplify_pcm16(frame, self.cfg.get("input_gain", 1))
                if time.monotonic() < self.mute_until:
                    self.segmenter.reset()
                    continue
                pcm = self.segmenter.push(frame, self.vad.is_speech(frame, SAMPLE_RATE))
                if pcm is None:
                    self._maybe_react()
                    continue
                t0 = time.monotonic()
                text = self.transcribe(pcm)
                spent = time.monotonic() - t0
                # chronométrage du tour : de la fin de la phrase entendue au 1er son du robot
                self.turn = {"end": t0 - self.cfg["end_silence_ms"] / 1000.0, "whisper": spent,
                             "heard": time.monotonic()}
                log.info("Entendu (%.1f s audio, %.1f s calcul) : %s", len(pcm) / 2 / SAMPLE_RATE, spent, text)
                if spent > 8:
                    log.warning("Whisper très lent (%.0f s) : processeur surchargé ou trop chaud ? "
                                "(vcgencmd measure_temp ; top)", spent)
                if text and is_hallucination(text, self.cfg.get("vocabulary", "")):
                    log.info("(ignoré : invention de Whisper sur du bruit)")
                elif text:
                    self.handle(text)
                if self.turn and "queued" not in self.turn:
                    self.turn = None   # bruit ou phrase sans réponse : le chrono ne doit pas servir à la suivante
                # ce qui a été capté pendant le calcul est périmé
                self._flush_audio()

    def _background(self, speaker):
        """Phrase sans « Kamil » pendant la fenêtre de suite : télé, radio ou autre conversation ?
        Écartée si c'est un long discours continu, ou une voix inconnue (reconnaissance des voix active)."""
        seconds = len(self._last_audio) / float(SAMPLE_RATE) if self._last_audio is not None else 0.0
        if seconds >= self.cfg.get("follow_up_max_audio_s", 8):
            log.info("(ignoré : %.0f s de parole continue sans « Kamil », sans doute télé ou radio)", seconds)
            return True
        if speaker == "" and (self.cfg.get("speaker_id") or {}).get("follow_up_known_voices_only", True):
            log.info("(ignoré : voix inconnue sans « Kamil », sans doute télé, radio ou autre conversation)")
            return True
        return False

    def _identify(self):
        """Prénom de la personne qui vient de parler, "" si voix inconnue, None si désactivé."""
        if self.voices is None or self._last_audio is None:
            return None
        try:
            name, score = self.voices.identify(self._last_audio)
        except Exception as e:
            log.warning("Voix non analysée : %s", e)
            return None
        if score is not None:
            log.info("Voix : %s (%.2f)", name or "inconnue", score)
        if getattr(self, "ha", None) is not None:
            self.ha.publish("voix", name or "inconnue")
        return name or ""

    def _maybe_react(self):
        """Entre deux phrases : tient le journal de surveillance et réagit à ce que voient les caméras."""
        watcher = getattr(self, "watcher", None)
        if watcher is not None:
            alert = watcher.poll()        # le journal est tenu en continu, même pendant qu'on parle
            if alert:
                log.warning("🚨 Mode garde : %s", alert)
                self._pending_alert = alert
                self._notify_phone(alert)
                if getattr(self, "ha", None) is not None:
                    # heure comprise : chaque alerte change l'entité (déclencheur Home Assistant)
                    self.ha.publish("alerte", "%s : %s" % (time.strftime("%H:%M:%S"), alert))
        if self.segmenter.triggered:
            return   # quelqu'un est en train de parler : on ne lui coupe pas la parole
        if getattr(self, "ha", None) is not None:
            if hasattr(self.ha, "poll"):
                self.ha.poll()           # demandes déposées par l'Atelier
            if time.monotonic() >= self.mute_until:
                self._ha_command()
        if self.brain is None:
            return
        if time.monotonic() < self.mute_until:
            return
        alert, self._pending_alert = getattr(self, "_pending_alert", None), None
        if alert:
            event = ("garde", "[Alerte du mode garde] " + alert)
        elif self.reactions is not None:
            event = self.reactions.poll()
        else:
            event = None
        if event is None:
            return
        self.status("thinking")
        try:
            said = self.brain.notice(event[1])
        except Exception:  # une réaction ratée ne doit jamais arrêter l'écoute
            log.exception("Réaction impossible")
            said = None
        finally:
            self.status("idle")
        if said is not None:
            if getattr(self, "ha", None) is not None:
                self.ha.publish("reponse", said)
            if self.reactions is not None:
                self.reactions.on_conversation()
            self._follow_up()   # la personne peut répondre sans dire « Kamil »
        self._flush_audio()

    def _ha_command(self):
        """Une demande venue de Home Assistant : « Kamil dit », question, mode garde."""
        try:
            kind, value = self.ha.commands.get_nowait()
        except queue.Empty:
            return
        log.info("Home Assistant demande : %s %s", kind, value)
        if kind == "dire":
            self.say(value)
            self.ha.publish("reponse", value)
        elif kind == "question":
            self._last_audio = None   # pas de voix à reconnaître : la question est écrite
            self.turn = None          # ni micro ni Whisper : pas de chrono « après ta phrase »
            self.handle(value, addressed=True)
        elif kind == "garde":
            watcher = getattr(self, "watcher", None)
            if watcher is not None:
                was = watcher.guard
                watcher.set_guard(value)
                if bool(value) != was:
                    delay = int(watcher.cfg.get("exit_delay_s") or 0)
                    self.say(("Mode garde activé. Je surveille la maison dans %d secondes, tu as le temps de partir."
                              % delay if delay else "Mode garde activé, je surveille la maison.")
                             if value else "Mode garde désactivé. Bon retour !")
            else:
                self.ha.guard(False)
                log.warning("Mode garde impossible : surveillance désactivée (brain.watch)")
        self._flush_audio()

    def _notify_phone(self, alert):
        """Mode garde : prévient un ou plusieurs téléphones par Home Assistant (services notify),
        sans bloquer l'écoute. notify_service : "notify.mobile_app_x" ou une liste de services."""
        services = (self.watcher.cfg.get("notify_service") or []) if getattr(self, "watcher", None) else []
        if isinstance(services, str):
            services = [services]
        services = [s for s in services if isinstance(s, str) and "." in s]
        if not services:
            return
        home = getattr(self.brain, "home", None) if self.brain is not None else None
        if home is None:
            log.warning("Alerte non envoyée aux téléphones : Home Assistant n'est pas branché (brain.home_assistant)")
            return
        # photos : images des caméras de Kamil vues par Home Assistant (entités caméra MQTT, une image
        # toutes les 2 s) ; une notification par caméra, la 1re porte le texte de l'alerte
        images = self.watcher.cfg.get("notify_images", ["/api/camera_proxy/camera.kamil_camera_1",
                                                        "/api/camera_proxy/camera.kamil_camera_2"])
        if isinstance(images, str):
            images = [images]
        notes = []
        for i, image in enumerate(images or [None]):
            extra = {"priority": "high", "ttl": 0, "channel": "Alarme Kamil"}
            if image:
                extra["image"] = image
            notes.append({"title": "🚨 Kamil – mode garde" if i == 0 else "📷 Kamil – caméra %d" % (i + 1),
                          "message": alert if i == 0 else "Photo de la caméra %d" % (i + 1), "data": extra})

        def send():
            for service in services:
                for data in notes:
                    ok, said = home.call_service(*service.split(".", 1), data)
                    (log.info if ok else log.warning)("Alerte envoyée à %s : %s", service, said)
        threading.Thread(target=send, name="alerte-telephones", daemon=True).start()

def other_listeners(proc_dir="/proc"):
    """Numéros des autres speech_listener.py en marche (Linux), pour ne pas en lancer un deuxième."""
    found = []
    try:
        entries = os.listdir(proc_dir)
    except OSError:
        return found
    for entry in entries:
        if not entry.isdigit() or int(entry) == os.getpid():
            continue
        try:
            with open(os.path.join(proc_dir, entry, "cmdline"), "rb") as f:
                argv = [a.decode("utf-8", "replace") for a in f.read().split(b"\0") if a]
        except OSError:
            continue
        if (len(argv) > 1 and "python" in os.path.basename(argv[0])
                and any(os.path.basename(a) == "speech_listener.py" for a in argv[1:3]) and "--list-devices" not in argv):
            found.append(int(entry))
    return sorted(found)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--config", default=os.path.join(os.path.dirname(__file__), "..", "config.json"))
    parser.add_argument("--list-devices", action="store_true", help="affiche les micros disponibles")
    parser.add_argument("--dry-run", action="store_true", help="n'envoie rien à MyRobotLab")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args()
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
    )
    if args.list_devices:
        print(sd.query_devices())
        return 0

    other = other_listeners()
    if other:
        # deux Kamil se disputeraient le micro (erreur PortAudio « Invalid number of channels »)
        log.error("Kamil tourne déjà (processus %s, lancé par l'Atelier ou dans un autre terminal). "
                  "Arrêtez-le d'abord : Atelier → Services → « Kamil : voix et IA » → Arrêter, "
                  "ou : pkill -f speech_listener.py", ", ".join(map(str, other)))
        return 1
    cfg = load_config(args.config)
    base = os.path.dirname(os.path.abspath(args.config))
    # chemins relatifs = relatifs au dossier de config.json
    for section, key in (("voice", "piper_model"), ("brain", "memory_path"), ("brain", "recorded_gestures_dir")):
        value = cfg.get(section, {}).get(key)
        if value and not os.path.isabs(value):
            cfg[section][key] = os.path.join(base, value)
    spk_cfg = cfg.get("voice", {}).get("speaker_id") or {}
    for key in ("model", "db_path"):
        if spk_cfg.get(key) and not os.path.isabs(spk_cfg[key]):
            spk_cfg[key] = os.path.join(base, spk_cfg[key])
    watch_cfg = cfg.get("brain", {}).get("watch") or {}
    for key, default in (("journal_path", "data/journal.jsonl"), ("snapshots_dir", "data/surveillance")):
        value = watch_cfg.get(key) or default    # dans le dossier inmoov, comme les autres données
        watch_cfg[key] = value if os.path.isabs(value) else os.path.join(base, value)
    mind_cfg = cfg.get("brain", {}).get("mind") or {}
    for key in ("environment_path", "mood_path", "episodes_path"):
        if mind_cfg.get(key) and not os.path.isabs(mind_cfg[key]):
            mind_cfg[key] = os.path.join(base, mind_cfg[key])
    mrl = MrlClient(cfg["mrl"]["url"], cfg["mrl"]["timeout_s"])
    try:
        Listener(cfg["voice"], mrl, args.dry_run, cfg.get("brain"),
                 cfg.get("local_llm"), cfg.get("leds"), cfg.get("mqtt")).run()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
