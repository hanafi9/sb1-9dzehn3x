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
    def __init__(self, cfg, mrl, dry_run=False, brain_cfg=None, local_cfg=None, leds_cfg=None):
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
                self.pipeline.on_play_start = self._on_first_sound
            log.info("Voix hors ligne Piper : %s", cfg["piper_model"])
            from reasoning import FILLERS, THINKING_PHRASES

            self.brain_cfg = brain_cfg
            self.tts.warm_up(list(cfg.get("wake_replies") or (WAKE_REPLIES_FUNNY if self._funny() else WAKE_REPLIES))
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
            log.info("IA locale de secours : %s (%s)", local_cfg["model"], local_cfg["url"])
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
        self.cloud = None
        if (cfg.get("cloud_stt") or {}).get("enabled"):
            from cloud_stt import CloudTranscriber

            self.cloud = CloudTranscriber(cfg["cloud_stt"])
            log.info("Reconnaissance vocale en ligne : %s (%s), Whisper du Pi en secours",
                     cfg["cloud_stt"].get("provider", "groq"), self.cloud.model)
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
        if getattr(self, "cloud", None) is not None:
            from cloud_stt import CloudError

            try:
                return self.cloud.transcribe(audio)
            except CloudError as e:
                log.warning("Reconnaissance en ligne impossible (%s) : Whisper du Pi", e)
        text, confidence, doubtful = self._whisper(self.model, audio, self.cfg["beam_size"])
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
        self.status("speaking")
        if self.pipeline is not None:
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
        self.status("speaking")
        self.pipeline.put(text)

    def _on_first_sound(self, text):
        """Journal du délai de réponse, décomposé, pour voir quelle étape est lente."""
        turn, self.turn = getattr(self, "turn", None), None
        now = time.monotonic()
        if not turn or "queued" not in turn or now - turn["end"] > 30:   # vieille phrase ignorée
            return
        log.info("⏱ 1er son %.1f s après la fin de ta phrase = silence de fin %.1f + Whisper %.1f "
                 "+ Claude (1re phrase) %.1f + Piper %.1f  [« %s »]",
                 now - turn["end"], self.cfg["end_silence_ms"] / 1000.0, turn["whisper"],
                 turn["queued"] - turn["heard"], now - turn["queued"], text[:40])

    def wait_speech(self):
        """Attend la fin de tout ce qui est dans la file de Piper."""
        self.pipeline.wait()
        self.mute_until = max(self.mute_until, time.monotonic() + 0.3)

    def status(self, state):
        """Couleur des LED d'état (facultatif, service NeoPixel d'InMoov2)."""
        if self.leds is None:
            return
        r, g, b = self.leds.get("colors", {}).get(state, LED_COLORS[state])
        self._call_checked(self.leds["service"], "fill", r, g, b)

    def _funny(self):
        brain_cfg = getattr(self, "brain_cfg", None) or {}
        return int((brain_cfg.get("personality") or {}).get("humour", 2)) >= 3

    def _wake_reply(self):
        """Réponse immédiate à « Kamil ! » seul, variée pour ne pas sonner comme une machine."""
        replies = self.cfg.get("wake_replies") or (WAKE_REPLIES_FUNNY if self._funny() else WAKE_REPLIES)
        last = getattr(self, "_last_wake_reply", None)
        reply = random.choice([r for r in replies if r != last] or replies)
        self._last_wake_reply = reply
        return reply

    def _mute_for(self, text):
        # Le micro entendrait la voix du robot : on l'ignore le temps qu'il parle.
        if text:
            self.mute_until = time.monotonic() + 0.5 + len(text) * self.cfg["seconds_per_char"]

    def handle(self, text):
        now = time.monotonic()
        awake = now < self.awake_until
        # le mot de réveil est retiré même si le robot est déjà réveillé (« Kamil… » puis « Kamil, … »)
        found, rest = strip_wake_word(text, self.cfg["wake_words"])
        if not found and self.cfg["wake_words"]:
            # avec la télé allumée, la phrase dure jusqu'à 12 s : « Kamil » peut être au milieu
            after = find_wake_word_anywhere(text, self.cfg["wake_words"])
            if after is not None:
                log.info("(« %s » entendu au milieu de la phrase : on garde la suite)", self.cfg["wake_words"][0])
                found, rest = True, after
        if not awake and not found:
            log.info("(pas de mot de réveil) %s", text)
            return
        if found:
            if not rest:
                self.awake_until = now + self.cfg["wake_window_s"]
                self.say(self._wake_reply())
                self.status("awake")
                return
            text = rest
        self.awake_until = 0.0
        speaker = self._identify()
        if not found and self._background(speaker):
            return
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
                if not answered:
                    log.warning("Claude indisponible")

            if not answered and self.local is not None:
                reply = self.local.ask(text)
                if reply:
                    log.info("Réponse de l'IA locale : %s", reply)
                    self.say(reply)
                    answered = True
                else:
                    log.warning("IA locale indisponible")
        finally:
            self.status("idle")
        if answered:
            self._follow_up(question=isinstance(said, str) and said.rstrip().endswith("?"))
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
        return name or ""

    def _maybe_react(self):
        """Entre deux phrases : tient le journal de surveillance et réagit à ce que voient les caméras."""
        watcher = getattr(self, "watcher", None)
        if watcher is not None:
            alert = watcher.poll()        # le journal est tenu en continu, même pendant qu'on parle
            if alert:
                self._pending_alert = alert
                self._notify_phone(alert)
        if self.brain is None or self.segmenter.triggered:
            return   # quelqu'un est en train de parler : on ne lui coupe pas la parole
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
            if self.reactions is not None:
                self.reactions.on_conversation()
            self._follow_up()   # la personne peut répondre sans dire « Kamil »
        self._flush_audio()

    def _notify_phone(self, alert):
        """Mode garde : prévient un téléphone par Home Assistant (service notify), sans bloquer l'écoute."""
        service = (self.watcher.cfg.get("notify_service") or "") if getattr(self, "watcher", None) else ""
        home = getattr(self.brain, "home", None) if self.brain is not None else None
        if "." not in service or home is None:
            return
        domain, name = service.split(".", 1)
        threading.Thread(target=lambda: log.info("Alerte envoyée au téléphone : %s", home.call_service(
            domain, name, {"title": "Kamil – mode garde", "message": alert})[1]), daemon=True).start()

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
                 cfg.get("local_llm"), cfg.get("leds")).run()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
