"""Offline PCM16LE 16kHz mono -> newline-delimited JSON captions on stdout.
The existing Meet preload already captures and resamples remote WebRTC audio.
Requires: pip install faster-whisper numpy
"""
import json
import os
import queue
import sys
import threading
import numpy as np

RATE = 16000
WINDOW = float(os.environ.get('ZAPPER_ASR_WINDOW', '1.6'))
MODEL = os.environ.get('ZAPPER_ASR_MODEL', 'small.en')
TERMS = os.environ.get('ZAPPER_ASR_TERMS', 'Kubernetes, K8s, AWS, EKS, Terraform, Docker, Kafka, Redis, PostgreSQL, CI/CD, GitHub Actions, Java, Spring Boot, Node.js, React, TypeScript, GraphQL, microservices, Helm, Argo CD, Istio, gRPC')
frames = queue.Queue(maxsize=160)

def emit(event):
    print(json.dumps(event, ensure_ascii=False), flush=True)

def reader():
    while True:
        data = sys.stdin.buffer.read(3200)  # 100 ms, 16 kHz PCM16LE
        if not data:
            frames.put(None)
            return
        try:
            frames.put_nowait(data)
        except queue.Full:
            try: frames.get_nowait()
            except queue.Empty: pass
            frames.put_nowait(data)

def main():
    from faster_whisper import WhisperModel
    device = os.environ.get('ZAPPER_ASR_DEVICE', 'cpu')
    compute = os.environ.get('ZAPPER_ASR_COMPUTE', 'int8' if device == 'cpu' else 'float16')
    model = WhisperModel(MODEL, device=device, compute_type=compute)
    emit({'type': 'status', 'text': 'Local Whisper ready (' + MODEL + ')'})
    threading.Thread(target=reader, daemon=True).start()
    chunks = []
    samples = 0
    target = max(8000, int(WINDOW * RATE))
    while True:
        item = frames.get()
        if item is None: break
        chunks.append(item)
        samples += len(item) // 2
        if samples < target: continue
        pcm = b''.join(chunks)
        chunks, samples = [], 0
        audio = np.frombuffer(pcm[:len(pcm) // 2 * 2], dtype='<i2').astype(np.float32) / 32768.0
        if not len(audio) or float(np.sqrt(np.mean(audio ** 2))) < 0.004: continue
        # Keep the freshest audio rather than accumulating a multi-minute backlog.
        if frames.qsize() > 60:
            while frames.qsize() > 20:
                try: frames.get_nowait()
                except queue.Empty: break
        segments, _ = model.transcribe(audio, language='en', beam_size=2,
            initial_prompt='Technical discussion: ' + TERMS, condition_on_previous_text=False,
            vad_filter=False, temperature=0)
        text = ' '.join(s.text.strip() for s in segments).strip()
        if text:
            emit({'type': 'transcript', 'text': text, 'isFinal': True, 'source': 'local-whisper'})

if __name__ == '__main__':
    try: main()
    except Exception as exc:
        print('Local Whisper failure: ' + repr(exc), file=sys.stderr, flush=True)
        sys.exit(1)
