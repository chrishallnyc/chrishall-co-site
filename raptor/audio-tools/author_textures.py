#!/usr/bin/env python3
"""Author small, reproducible mono afterburner loop auditions from DVIDS 742566.

Uses the scientific dependencies in audio-tools/requirements.txt. No network,
paid APIs, compression, limiting, or master loudness normalization. Outputs are
research candidates; this tool does not install production audio assets.
"""

from argparse import ArgumentParser
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
import hashlib
import json
import math
import platform
import wave

import numpy as np
import scipy
from scipy import signal
from scipy.io import wavfile


ROOT = Path(__file__).resolve().parents[2]
RATE = 48000
SOURCE_SHA256 = "8ff73ae8c99a7ba3c6cde0e1026f5d4461b3f7e9776e734ac2ac1164d29ea1c7"
SOURCE_FOLDER = ROOT / ".context/raptor-audio-references/742566"
OUTPUT_FOLDER = ROOT / ".context/audio-production/texture-candidates"
REVIEW_FILE = ROOT / ".context/audio-production/critiques/reference-round1-bfc42320.json"
BANDS = [(20, 80), (80, 250), (250, 1000), (1000, 4000), (4000, 12000)]
CANDIDATES = [
    {
        "id": "a-grounded",
        "intent": "Reference texture; DC cleanup and 24 Hz high-pass only.",
        "source_start_seconds": 0.45,
        "loop_seconds": 8.0,
        "overlap_seconds": 2.0,
        "eq": [],
        "body": None,
        "dither_seed": 61721,
    },
    {
        "id": "b-dense",
        "intent": "Restrained low-mid weight, with a gently softened upper edge.",
        "source_start_seconds": 0.60,
        "loop_seconds": 8.25,
        "overlap_seconds": 1.75,
        "eq": [
            {"kind": "bell", "frequency_hz": 650, "q": 0.65, "gain_db": 1.5},
            {"kind": "high_shelf", "frequency_hz": 4500, "slope": 1, "gain_db": -1.8},
        ],
        "body": None,
        "dither_seed": 61722,
    },
    {
        "id": "c-tactile",
        "intent": "Subtle authored body underneath the actual test texture; not an authentic separate engine recording.",
        "source_start_seconds": 0.80,
        "loop_seconds": 7.5,
        "overlap_seconds": 2.5,
        "eq": [],
        "body": {
            "source_start_seconds": 1.20,
            "source_loop_seconds": 3.75,
            "overlap_seconds": 1.5,
            "playback_rate": 0.5,
            "bandpass_hz": [55, 420],
            "rms_db_relative_to_main": -18.0,
        },
        "dither_seed": 61723,
    },
]


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def db(amplitude):
    return float(20 * np.log10(max(float(amplitude), 1e-15)))


def rms(samples):
    return float(np.sqrt(np.mean(samples * samples)))


def overlap_loop(source, start_seconds, loop_seconds, overlap_seconds):
    """Place a long equal-power overlap inside a naturally continuous wrap.

    For N output samples and L overlap samples, source[start:start+N+L]
    supplies the data. The first L output samples crossfade source[N:N+L]
    into source[0:L]; the remaining samples are source[L:N]. Thus the wrap
    itself connects consecutive source samples N-1 -> N, and the overlap
    ends on consecutive source samples L-1 -> L. A smoothstep phase makes
    both crossfade weights' slopes zero at each end.
    """
    start = round(start_seconds * RATE)
    size, overlap = round(loop_seconds * RATE), round(overlap_seconds * RATE)
    if not (0 < overlap < size and start >= 0 and start + size + overlap <= len(source)):
        raise ValueError("The requested source span/overlap is unavailable")
    fragment = source[start:start + size + overlap]
    output = fragment[:size].copy()
    phase = np.linspace(0, 1, overlap)
    phase = (3 * phase ** 2 - 2 * phase ** 3) * np.pi / 2
    output[:overlap] = fragment[size:size + overlap] * np.cos(phase) + fragment[:overlap] * np.sin(phase)
    return output


def periodic_filter(samples, sos):
    """Apply a stable IIR response as circular convolution, avoiding reset edges."""
    frequencies = np.fft.rfftfreq(len(samples), d=1 / RATE)
    _, response = signal.sosfreqz(sos, worN=frequencies, fs=RATE)
    return np.fft.irfft(np.fft.rfft(samples) * response, n=len(samples))


def eq_filter(spec):
    """RBJ peaking/high-shelf biquads, represented as one SciPy SOS row."""
    amplitude = 10 ** (spec["gain_db"] / 40)
    omega = 2 * np.pi * spec["frequency_hz"] / RATE
    cosine, sine = np.cos(omega), np.sin(omega)
    if spec["kind"] == "bell":
        alpha = sine / (2 * spec["q"])
        b = [1 + alpha * amplitude, -2 * cosine, 1 - alpha * amplitude]
        a = [1 + alpha / amplitude, -2 * cosine, 1 - alpha / amplitude]
    elif spec["kind"] == "high_shelf":
        alpha = sine / 2 * np.sqrt((amplitude + 1 / amplitude) * (1 / spec["slope"] - 1) + 2)
        beta = 2 * np.sqrt(amplitude) * alpha
        b = [amplitude * ((amplitude + 1) + (amplitude - 1) * cosine + beta),
             -2 * amplitude * ((amplitude - 1) + (amplitude + 1) * cosine),
             amplitude * ((amplitude + 1) + (amplitude - 1) * cosine - beta)]
        a = [(amplitude + 1) - (amplitude - 1) * cosine + beta,
             2 * ((amplitude - 1) - (amplitude + 1) * cosine),
             (amplitude + 1) - (amplitude - 1) * cosine - beta]
    else:
        raise ValueError(f"Unknown EQ kind: {spec['kind']}")
    return np.array([[*(np.array(b) / a[0]), *(np.array(a) / a[0])]])


def choose_quiet_boundary(samples):
    """Rotate an already circular loop near its origin without changing samples.

    A quiet zero-crossing neighborhood also makes starting/stopping the raw
    audition less abrupt. It is not a repair for a discontinuous splice.
    """
    radius = round(0.01 * RATE)
    indices = np.arange(-radius, radius + 1) % len(samples)
    before = samples[(indices - 1) % len(samples)]
    after = samples[indices]
    previous_step = before - samples[(indices - 2) % len(samples)]
    next_step = samples[(indices + 1) % len(samples)] - after
    score = np.abs(before) + np.abs(after) + 0.25 * np.abs(next_step - previous_step)
    selected = int(indices[np.argmin(score)])
    signed = selected if selected <= len(samples) // 2 else selected - len(samples)
    return np.roll(samples, -selected), signed


def author(source, spec):
    output = overlap_loop(source, spec["source_start_seconds"], spec["loop_seconds"], spec["overlap_seconds"])
    output -= np.mean(output)
    for eq in spec["eq"]:
        output = periodic_filter(output, eq_filter(eq))

    body_gain = None
    if spec["body"]:
        body_spec = spec["body"]
        body = overlap_loop(source, body_spec["source_start_seconds"], body_spec["source_loop_seconds"], body_spec["overlap_seconds"])
        # Fourier resampling is valid here because the authored loop is
        # periodic. Doubling sample count at unchanged RATE lowers pitch one
        # octave and maps one complete 3.75 s cycle into one 7.5 s cycle.
        body = signal.resample(body, len(output))
        body = periodic_filter(body, signal.butter(2, body_spec["bandpass_hz"], btype="bandpass", fs=RATE, output="sos"))
        body_gain = rms(output) * 10 ** (body_spec["rms_db_relative_to_main"] / 20) / max(rms(body), 1e-15)
        output += body * body_gain

    output = periodic_filter(output, signal.butter(2, 24, btype="highpass", fs=RATE, output="sos"))
    output -= np.mean(output)
    if not np.isfinite(output).all() or np.max(np.abs(output)) >= 0.98:
        raise ValueError(f"{spec['id']}: non-finite audio or insufficient headroom; no automatic limiting is allowed")
    output, rotation = choose_quiet_boundary(output)
    rng = np.random.Generator(np.random.PCG64(spec["dither_seed"]))
    dither = (rng.random(len(output)) - rng.random(len(output))) / 32768
    pcm = np.rint((output + dither) * 32768).astype("<i2")
    payload = BytesIO()
    with wave.open(payload, "wb") as writer:
        writer.setnchannels(1)
        writer.setsampwidth(2)
        writer.setframerate(RATE)
        writer.writeframes(pcm.tobytes())
    return payload.getvalue(), pcm.astype(np.float64) / 32768, {
        "boundary_rotation_samples": rotation,
        "boundary_rotation_seconds": rotation / RATE,
        "body_static_gain_db": db(body_gain) if body_gain is not None else None,
        "master_gain_db": 0.0,
    }


def measure(samples):
    differences = np.diff(samples)
    absolute_steps = np.abs(differences)
    seam_step = float(samples[0] - samples[-1])
    internal_step_rms = rms(differences)
    before_step, after_step = float(samples[-1] - samples[-2]), float(samples[1] - samples[0])
    peak, level = float(np.max(np.abs(samples))), rms(samples)
    windows = {}
    for milliseconds in [5, 20, 100, 250]:
        size = round(milliseconds * RATE / 1000)
        pre, post = samples[-size:], samples[:size]
        crossing = np.r_[pre[-size // 2:], post[:size // 2]]
        windows[str(milliseconds)] = {
            "before_rms_dbfs": db(rms(pre)), "after_rms_dbfs": db(rms(post)),
            "crossing_rms_dbfs": db(rms(crossing)),
            "after_minus_before_db": db(rms(post)) - db(rms(pre)),
        }
    size = round(0.1 * RATE)
    tiled = np.r_[samples, samples[:size]]
    envelope = np.array([rms(tiled[start:start + size]) for start in range(0, len(samples), size)])
    frequencies, density = signal.welch(samples, fs=RATE, nperseg=8192)
    audible = (frequencies >= 20) & (frequencies < 12000)
    total = float(np.sum(density[audible]))
    bands = {f"{lo}-{hi}": float(np.sum(density[(frequencies >= lo) & (frequencies < hi)]) / total) for lo, hi in BANDS}
    return {
        "sample_rate": RATE, "channels": 1, "format": "PCM16 WAV",
        "frames": len(samples), "duration_seconds": len(samples) / RATE,
        "rms_dbfs": db(level), "sample_peak_dbfs": db(peak), "crest_db": db(peak / level),
        "dc_offset_fs": float(np.mean(samples)), "dc_offset_lsb": float(np.mean(samples) * 32768),
        "samples_at_full_scale": int(np.count_nonzero(np.abs(samples) >= 1)),
        "seam": {
            "last_sample": float(samples[-1]), "first_sample": float(samples[0]),
            "sample_step_fs": seam_step, "sample_step_dbfs": db(abs(seam_step)),
            "derivative_fs_per_second": seam_step * RATE,
            "internal_step_rms_fs": internal_step_rms,
            "step_relative_to_internal_step_rms_db": db(abs(seam_step) / internal_step_rms),
            "absolute_step_percentile_among_internal_steps": float(np.mean(absolute_steps <= abs(seam_step)) * 100),
            "internal_absolute_step_p99_fs": float(np.percentile(absolute_steps, 99)),
            "preceding_step_fs": before_step, "following_step_fs": after_step,
            "step_curvature_before_fs": seam_step - before_step,
            "step_curvature_after_fs": after_step - seam_step,
            "window_rms": windows,
        },
        "envelope_100ms": {
            "p95_minus_p05_db": db(np.percentile(envelope, 95)) - db(np.percentile(envelope, 5)),
            "minimum_dbfs": db(np.min(envelope)), "maximum_dbfs": db(np.max(envelope)),
            "rms_dbfs": [db(value) for value in envelope],
        },
        "spectrum": {
            "centroid_hz_20_to_12000": float(np.sum(frequencies[audible] * density[audible]) / total),
            "band_power_fraction": bands,
        },
    }


def read_source(path):
    payload = path.read_bytes()
    if sha256(payload) != SOURCE_SHA256:
        raise ValueError("Source SHA256 differs from the reviewed DVIDS 742566 PCM extract")
    rate, samples = wavfile.read(BytesIO(payload))
    if rate != RATE or samples.dtype != np.int16 or samples.ndim != 2 or samples.shape[1] != 2:
        raise ValueError("Expected reviewed 48 kHz stereo PCM16 extract")
    mono = np.mean(samples.astype(np.float64) / 32768, axis=1)
    mono -= np.mean(mono)
    return mono


def main():
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=SOURCE_FOLDER / "audio.wav")
    parser.add_argument("--source-record", type=Path, default=SOURCE_FOLDER / "source.json")
    parser.add_argument("--output", type=Path, default=OUTPUT_FOLDER)
    parser.add_argument("--verify-repeat", action="store_true", help="Render twice in memory and assert identical WAV hashes")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    source = read_source(args.source)
    record = json.loads(args.source_record.read_text())
    manifest = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "purpose": "Afterburner texture auditions only; no engine integration or production asset installation",
        "source": {
            "pcm_path": str(args.source.resolve()), "pcm_sha256": SOURCE_SHA256,
            "duration_seconds": len(source) / RATE,
            "metadata_path": str(args.source_record.resolve()),
            "metadata_sha256": sha256(args.source_record.read_bytes()),
            "official_page": record["page_url"], "preview_url": record["selected_preview_url"],
            "author": record["author"], "unit": record["unit"], "virin": record["virin"],
            "item_rights_label": record["rights"], "rights_notice": record["rights_url"],
            "interpretation": "Visually stationary afterburning test-cell engine; no claim this is idle, a clean-room measurement, or onboard cabin sound",
            "root_authorization": "Root authorized local texture authoring after verifying official item rights and reviewing source via audio-capable model",
            "audio_model_review_path": str(REVIEW_FILE) if REVIEW_FILE.exists() else None,
            "audio_model_review_sha256": sha256(REVIEW_FILE.read_bytes()) if REVIEW_FILE.exists() else None,
            "auditory_review_limit": "gpt-audio-1.5 reported continuous roar with no speech/music and possible mild distortion; automated opinion, not verified human listening",
        },
        "process": {
            "script": str(Path(__file__).resolve()), "script_sha256": sha256(Path(__file__).read_bytes()),
            "python": platform.python_version(), "numpy": np.__version__, "scipy": scipy.__version__,
            "mono": "Arithmetic mean: 0.5L + 0.5R; no equal-power downmix gain",
            "loop": "Long smoothstep-phase equal-power tail/head overlap with natural consecutive-source wrap; circular EQ/high-pass; quiet-boundary rotation <=10ms",
            "highpass": "24 Hz, second-order Butterworth, applied with circular frequency-response convolution",
            "dc": "Mean removed from source and final floating-point loops before PCM quantization",
            "dither": "Deterministic PCG64-seeded TPDF at +/-1 PCM16 LSB before round-to-nearest quantization",
            "dynamics": "No compressor, limiter, clipper, master normalization or automatic peak gain; C has one explicitly measured quiet parallel-body gain",
        },
        "candidates": [],
    }
    total_bytes = 0
    for spec in CANDIDATES:
        payload, samples, process = author(source, spec)
        if args.verify_repeat:
            repeated, _, _ = author(source, spec)
            if payload != repeated:
                raise AssertionError(f"{spec['id']}: repeated render changed WAV bytes")
        metrics = measure(samples)
        if metrics["samples_at_full_scale"] or abs(metrics["dc_offset_lsb"]) > 0.1:
            raise AssertionError(f"{spec['id']}: quantized clipping or DC check failed")
        if metrics["seam"]["absolute_step_percentile_among_internal_steps"] > 99:
            raise AssertionError(f"{spec['id']}: boundary step is unusually large")
        filename = spec["id"] + ".wav"
        (args.output / filename).write_bytes(payload)
        item = {**spec, "filename": filename, "bytes": len(payload), "sha256": sha256(payload),
                "source_end_seconds": spec["source_start_seconds"] + spec["loop_seconds"] + spec["overlap_seconds"],
                "authored_process": process, "metrics": metrics}
        manifest["candidates"].append(item)
        total_bytes += len(payload)
        print(f"{filename}: {metrics['duration_seconds']:.2f}s, RMS {metrics['rms_dbfs']:.2f}dBFS, "
              f"crest {metrics['crest_db']:.2f}dB, seam step {metrics['seam']['sample_step_dbfs']:.2f}dBFS")
    if total_bytes >= 4_000_000:
        raise AssertionError("Candidate WAV payload exceeds the 4 MB limit")
    manifest["total_wav_bytes"] = total_bytes
    manifest["repeat_hash_verified"] = args.verify_repeat
    (args.output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    rows = []
    for item in manifest["candidates"]:
        m = item["metrics"]
        rows.append(f"| [{item['id']}]({item['filename']}) | {m['duration_seconds']:.2f} | {m['rms_dbfs']:.2f} | "
                    f"{m['sample_peak_dbfs']:.2f} | {m['crest_db']:.2f} | {m['seam']['sample_step_dbfs']:.2f} | "
                    f"{m['seam']['window_rms']['100']['after_minus_before_db']:+.2f} |")
    report = ["# Afterburner texture auditions", "", "Three mono 48 kHz PCM16 candidates from the reviewed DVIDS 742566 test recording. "
              "These are audition artifacts, not installed production assets. Sound quality and perceived loop repetition still require listening.", "",
              f"WAV payload: {total_bytes:,} bytes. No master loudness normalization, limiting or compression.", "",
              "| Candidate | Seconds | RMS dBFS | Peak dBFS | Crest dB | Seam step dBFS | 100ms after/before dB |",
              "|---|---:|---:|---:|---:|---:|---:|", *rows, "",
              "A keeps the reference balance. B uses a +1.5 dB broad bell at 650 Hz and a -1.8 dB high shelf at 4.5 kHz. "
              "C adds a source-derived lower-octave 55–420 Hz body at -18 dB RMS relative to the main texture; that layer is authored, not a separately recorded F119 component.", "",
              "Loop lengths are 8.0 / 8.25 / 7.5 seconds; overlaps are 2.0 / 1.75 / 2.5 seconds. The wrap connects adjacent source samples before periodic filtering. "
              "Boundary rotation chooses a nearby quiet sample neighborhood without changing the cyclic waveform.", "",
              "The manifest includes source intervals, author, rights URLs, source/processor/output hashes, package versions, "
              "DC/crest/spectral measurements, seam derivative statistics, and 5 / 20 / 100 / 250 ms boundary RMS. "
              "A low seam-step value is diagnostic evidence, not a substitute for auditioning repeated cycles.", "",
              "Reproduce from the repository root:", "", "```sh",
              ".context/audio-analysis-venv/bin/python raptor/audio-tools/author_textures.py --verify-repeat", "```", "",
              f"Source: [{record['author']} — DVIDS 742566]({record['page_url']}). "
              f"Item label: {record['rights']}; [use restrictions]({record['rights_url']}). "
              "No endorsement or authenticity claim is made for the authored variants.", ""]
    (args.output / "README.md").write_text("\n".join(report))
    print(f"Total: {total_bytes:,} WAV bytes. Repeat-hash verification: {args.verify_repeat}.")


if __name__ == "__main__":
    main()
