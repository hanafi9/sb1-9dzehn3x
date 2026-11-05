"""Ouvrir le micro pour Kamil : toujours du 16 kHz mono en int16, par trames de `frame` échantillons.

Certains micros USB (Polycom Communicator…) n'acceptent que 48 kHz et 2 voies : on les ouvre
alors à leur fréquence, on garde la 1re voie et on convertit en 16 kHz (filtre passe-bas puis
rééchantillonnage), sans rien changer pour la suite (WebRTC VAD, Whisper).
"""

import logging

import numpy as np

log = logging.getLogger("voice")


class Resampler:
    """Convertit des blocs int16 (in_rate, `channels` voies) en int16 mono out_rate, bloc après bloc."""

    def __init__(self, in_rate, out_rate=16000, channels=1, taps=63):
        self.step = in_rate / out_rate
        self.channels = channels
        self.h = None
        if in_rate > out_rate:                       # passe-bas sous la moitié de out_rate (anti-repliement)
            cutoff = 0.45 * out_rate / in_rate
            n = np.arange(taps) - (taps - 1) / 2
            h = np.sinc(2 * cutoff * n) * np.hamming(taps)
            self.h = (h / h.sum()).astype(np.float32)
            self.hist = np.zeros(taps - 1, dtype=np.float32)
        self.pos = 0.0                                # position du prochain échantillon de sortie
        self.prev = 0.0                               # dernier échantillon du bloc précédent

    def process(self, data):
        x = np.frombuffer(data, dtype=np.int16).astype(np.float32)
        if self.channels > 1:
            x = x[: len(x) // self.channels * self.channels].reshape(-1, self.channels)[:, 0]
        if not len(x):
            return b""
        if self.h is not None:
            buf = np.concatenate([self.hist, x])
            y = np.convolve(buf, self.h, mode="valid")
            self.hist = buf[-(len(self.h) - 1):]
        else:
            y = x
        ext = np.concatenate([[self.prev], y])       # ext[i + 1] = y[i] ; ext[0] = fin du bloc d'avant
        positions = np.arange(self.pos, len(y) - 1, self.step)
        out = np.interp(positions + 1, np.arange(len(ext)), ext)
        self.pos = (positions[-1] + self.step if len(positions) else self.pos) - len(y)
        self.prev = y[-1]
        return np.clip(np.round(out), -32768, 32767).astype(np.int16).tobytes()


def open_mic(sd, device, callback, rate=16000, frame=480):
    """RawInputStream (pas encore démarré) qui appelle callback(trame, n, None, status) avec des trames
    de `frame` échantillons 16 kHz mono int16, même si le micro ne sait faire que 48 kHz / stéréo."""
    try:
        return sd.RawInputStream(samplerate=rate, blocksize=frame, dtype="int16", channels=1,
                                 device=device, callback=callback)
    except sd.PortAudioError as e:
        first = e
    info = sd.query_devices(device, "input")
    native = int(info["default_samplerate"])
    for channels in sorted({1, max(1, int(info["max_input_channels"]))}):
        resampler, pending = Resampler(native, rate, channels), bytearray()

        def convert(indata, n, t, status, resampler=resampler, pending=pending):
            pending.extend(resampler.process(bytes(indata)))
            while len(pending) >= frame * 2:
                callback(bytes(pending[:frame * 2]), frame, None, status)
                del pending[:frame * 2]
        try:
            stream = sd.RawInputStream(samplerate=native, blocksize=round(frame * native / rate), dtype="int16",
                                       channels=channels, device=device, callback=convert)
        except sd.PortAudioError:
            continue
        log.info("Micro « %s » ouvert en %d Hz, %d voie(s) : converti en %d Hz mono", info["name"], native,
                 channels, rate)
        return stream
    raise first
