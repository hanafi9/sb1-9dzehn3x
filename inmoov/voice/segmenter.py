"""Découpe le flux micro en phrases grâce à la détection de voix (VAD).

On n'envoie à Whisper que les morceaux où quelqu'un parle : c'est ce qui rend
la reconnaissance rapide sur un Raspberry Pi et évite les « phrases fantômes »
inventées par Whisper sur du bruit (moteurs des servos, ventilateur...).
"""

import collections


class UtteranceSegmenter:
    def __init__(self, frame_ms=30, padding_ms=300, end_silence_ms=700,
                 start_speech_ratio=0.6, min_utterance_ms=400, max_utterance_s=12):
        self.frame_ms = frame_ms
        self.pad_frames = max(1, padding_ms // frame_ms)
        self.end_frames = max(1, end_silence_ms // frame_ms)
        self.start_ratio = start_speech_ratio
        self.min_frames = max(1, min_utterance_ms // frame_ms)
        self.max_frames = int(max_utterance_s * 1000 // frame_ms)
        self.reset()

    def reset(self):
        self._ring = collections.deque(maxlen=self.pad_frames)
        self._frames = []
        self._speech_frames = 0
        self._silence = 0
        self.triggered = False

    def push(self, frame, is_speech):
        """Ajoute une trame audio. Renvoie les octets d'une phrase complète, sinon None."""
        if not self.triggered:
            self._ring.append((frame, is_speech))
            voiced = sum(1 for _, s in self._ring if s)
            if len(self._ring) == self._ring.maxlen and voiced >= self.start_ratio * self._ring.maxlen:
                self.triggered = True
                self._frames = [f for f, _ in self._ring]
                self._speech_frames = voiced
                self._silence = 0
                self._ring.clear()
            return None

        self._frames.append(frame)
        if is_speech:
            self._speech_frames += 1
            self._silence = 0
        else:
            self._silence += 1

        if self._silence >= self.end_frames or len(self._frames) >= self.max_frames:
            frames, speech = self._frames, self._speech_frames
            self.reset()
            if speech >= self.min_frames:
                return b"".join(frames)
        return None
