#!/usr/bin/env python3
"""Reconnaissance vocale améliorée pour InMoov (hors ligne, en français).

Chaîne : micro -> détection de voix (WebRTC VAD) -> Whisper (faster-whisper)
         -> mot de réveil -> commande locale
                          OU IA Claude (si "brain.enabled", voir llm_brain.py)
                          OU chatbot MyRobotLab (i01.chatBot) si Claude est injoignable

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
import sys
import time

import numpy as np
import sounddevice as sd
import webrtcvad
from faster_whisper import WhisperModel

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from mrl_client import MrlClient, load_config  # noqa: E402
from segmenter import UtteranceSegmenter  # noqa: E402
from text_utils import is_hallucination, match_command, strip_wake_word  # noqa: E402

log = logging.getLogger("voice")

SAMPLE_RATE = 16000  # Whisper et WebRTC VAD travaillent en 16 kHz
FRAME_MS = 30
FRAME_SAMPLES = SAMPLE_RATE * FRAME_MS // 1000


class Listener:
    def __init__(self, cfg, mrl, dry_run=False, brain_cfg=None):
        self.cfg = cfg
        self.mrl = mrl
        self.dry_run = dry_run
        self.brain = None
        if brain_cfg and brain_cfg.get("enabled"):
            from llm_brain import ClaudeBrain  # importé seulement si utilisé

            self.brain = ClaudeBrain(brain_cfg, self._call_checked, self.say)
            log.info("IA conversationnelle : Claude (%s)", brain_cfg["model"])
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
        segments, _ = self.model.transcribe(
            audio,
            language=self.cfg["language"],
            beam_size=self.cfg["beam_size"],
            initial_prompt=self.cfg.get("vocabulary") or None,
            condition_on_previous_text=False,
            vad_filter=False,  # déjà fait par WebRTC VAD
        )
        parts = []
        for seg in segments:
            if seg.no_speech_prob > self.cfg["max_no_speech_prob"]:
                log.debug("ignoré (no_speech %.2f) : %s", seg.no_speech_prob, seg.text)
                continue
            if seg.avg_logprob < self.cfg["min_avg_logprob"]:
                log.debug("ignoré (confiance %.2f) : %s", seg.avg_logprob, seg.text)
                continue
            parts.append(seg.text.strip())
        return " ".join(parts).strip()

    # --- actions -----------------------------------------------------------
    def _call(self, service, method, *params):
        return self._call_checked(service, method, *params)[1]

    def _call_checked(self, service, method, *params):
        log.info("-> %s.%s%s", service, method, params)
        if self.dry_run:
            return True, None
        return self.mrl.call_checked(service, method, *params)

    def say(self, text):
        self._call(self.cfg["mouth_service"], "speak", text)
        self._mute_for(text)

    def _mute_for(self, text):
        # Le micro entendrait la voix du robot : on l'ignore le temps qu'il parle.
        if text:
            self.mute_until = time.monotonic() + 0.5 + len(text) * self.cfg["seconds_per_char"]

    def handle(self, text):
        now = time.monotonic()
        awake = now < self.awake_until
        if not awake:
            found, rest = strip_wake_word(text, self.cfg["wake_words"])
            if not found:
                log.info("(pas de mot de réveil) %s", text)
                return
            if not rest:
                self.awake_until = now + self.cfg["wake_window_s"]
                self.say("oui ?")
                return
            text = rest
        self.awake_until = 0.0

        phrase, actions = match_command(text, self.cfg["commands"], self.cfg["fuzzy_threshold"])
        if actions:
            log.info("Commande : %s", phrase)
            for action in actions:
                self._call(*action)
            return

        if self.brain is not None:
            try:
                if self.brain.ask(text) is not None:
                    return
            except Exception:  # ex. clé API absente : le robot doit continuer d'écouter
                log.exception("Erreur inattendue de l'IA")
                self.brain.reset()
            log.warning("Claude indisponible, on utilise le chatbot d'InMoov2")

        resp = self._call(self.cfg["chatbot_service"], self.cfg["chatbot_method"], text)
        reply = resp.get("msg") if isinstance(resp, dict) else None
        log.info("Réponse du chatbot : %s", reply)
        self._mute_for(reply)

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
                if time.monotonic() < self.mute_until:
                    self.segmenter.reset()
                    continue
                pcm = self.segmenter.push(frame, self.vad.is_speech(frame, SAMPLE_RATE))
                if pcm is None:
                    continue
                t0 = time.monotonic()
                text = self.transcribe(pcm)
                log.info("Entendu (%.1f s audio, %.1f s calcul) : %s",
                         len(pcm) / 2 / SAMPLE_RATE, time.monotonic() - t0, text)
                if text and not is_hallucination(text):
                    self.handle(text)
                # ce qui a été capté pendant le calcul est périmé
                self._flush_audio()


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
    mrl = MrlClient(cfg["mrl"]["url"], cfg["mrl"]["timeout_s"])
    try:
        Listener(cfg["voice"], mrl, args.dry_run, cfg.get("brain")).run()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
