#!/usr/bin/env python3
"""Measure captured WAVs, create peak-safe level-matched pairs, and author a blind audition."""
from argparse import ArgumentParser
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import hashlib
import json
import math
import os
import re
import secrets
import shutil
import subprocess

os.environ.setdefault('MPLCONFIGDIR', str(Path(__file__).resolve().parents[2] / '.context/audio-review/matplotlib-cache'))
os.environ.setdefault('MPL_IGNORE_SYSTEM_FONTS', '1')
import matplotlib
matplotlib.use('Agg')
import numpy as np
from scipy import signal
from scipy.io import wavfile
from scipy.ndimage import median_filter

BANDS = [(20, 80), (80, 250), (250, 1000), (1000, 4000), (4000, 8000), (8000, 20000)]
EPS = 1e-16


def db(value):
    return float(20 * np.log10(max(float(value), 1e-12)))


def loudness(path):
    command = ['ffmpeg', '-hide_banner', '-nostats', '-i', str(path), '-af',
               'loudnorm=I=-23:TP=-3:LRA=50:print_format=json', '-f', 'null', '-']
    result = subprocess.run(command, text=True, capture_output=True, check=True)
    matches = re.findall(r'\{\s*"input_i".*?\}', result.stderr, re.S)
    if not matches:
        raise RuntimeError(f'FFmpeg did not report loudness for {path}')
    parsed = json.loads(matches[-1])
    return {'integrated_lufs': float(parsed['input_i']), 'true_peak_dbtp': float(parsed['input_tp']),
            'gate_lufs': float(parsed['input_thresh'])}


def correlation_at(samples, sr, seconds):
    lag = round(seconds * sr)
    if lag <= 0 or lag >= len(samples) // 2:
        return None
    a, b = samples[:-lag], samples[lag:]
    denominator = np.sqrt(np.dot(a, a) * np.dot(b, b))
    return float(np.dot(a, b) / denominator) if denominator > EPS else 0


def measure(path):
    sr, samples = wavfile.read(path)
    if np.issubdtype(samples.dtype, np.integer):
        samples = samples.astype(np.float64) / np.iinfo(samples.dtype).max
    else:
        samples = samples.astype(np.float64)
    if samples.ndim == 1:
        samples = np.column_stack([samples, samples])
    finite = np.isfinite(samples)
    if not finite.all():
        raise ValueError(f'{path}: {int((~finite).sum())} non-finite samples')
    left, right = samples[:, 0], samples[:, 1]
    mid, side = (left + right) / 2, (left - right) / 2
    rms = np.sqrt(np.mean(samples ** 2))
    peak = np.max(np.abs(samples))
    frequencies, density = signal.welch(samples, fs=sr, nperseg=16384, axis=0)
    psd = np.mean(density, axis=1)
    audible = (frequencies >= 20) & (frequencies <= min(20000, sr / 2))
    power = np.sum(psd[audible])
    bands = {f'{lo}-{hi}': float(np.sum(psd[(frequencies >= lo) & (frequencies < hi)]) / max(power, EPS)) for lo, hi in BANDS}
    band = (frequencies >= 1000) & (frequencies <= 5000)
    background = median_filter(psd, size=101, mode='nearest')
    prominence = 10 * np.log10((psd + EPS) / (background + EPS))
    narrow_index = np.flatnonzero(band)[np.argmax(prominence[band])]
    frame_size = round(sr * 0.1)
    framed = samples[:len(samples) // frame_size * frame_size].reshape(-1, frame_size, 2)
    envelope = np.sqrt(np.mean(framed ** 2, axis=(1, 2)))
    active = envelope[envelope > max(envelope) * 0.01]
    # Downsample the waveform with anti-alias filtering for recurrence analysis.
    # This intentionally describes the <1 kHz texture, not auditory masking.
    divisor = math.gcd(sr, 2000)
    texture = signal.resample_poly(mid, 2000 // divisor, sr // divisor)
    texture -= np.mean(texture)
    recurrence = {str(lag): correlation_at(texture, 2000, lag) for lag in [0.01, 0.02, 0.1, 0.5, 1, 2, 2.73, 3.07, 3.47, 3.93, 4, 6, 8]}
    # Retain autocorrelation peaks so new loop lengths need not be guessed.
    autocorrelation = signal.correlate(texture, texture, mode='full', method='fft')[len(texture) - 1:]
    sums = np.r_[0, np.cumsum(texture ** 2)]
    maximum_lag = min(round(12 * 2000), len(texture) // 2 - 1)
    lags = np.arange(1000, maximum_lag)
    denominator = np.sqrt(sums[len(texture) - lags] * (sums[-1] - sums[lags]))
    values = autocorrelation[lags] / np.maximum(denominator, EPS)
    found, _ = signal.find_peaks(values, distance=round(0.08 * 2000))
    strongest = sorted(found, key=lambda i: values[i], reverse=True)[:8]
    metrics = {
        'file': path.name, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
        'sample_rate': int(sr), 'duration_seconds': float(len(samples) / sr), 'channels': samples.shape[1],
        'loudness': loudness(path), 'sample_peak_dbfs': db(peak), 'rms_dbfs': db(rms),
        'crest_db': db(peak / max(rms, EPS)), 'dc_offset': np.mean(samples, axis=0).tolist(),
        'samples_at_or_above_full_scale': int(np.count_nonzero(np.abs(samples) >= 1)),
        'left_right_correlation': float(np.corrcoef(left, right)[0, 1]),
        'side_to_mid_db': db(np.sqrt(np.mean(side ** 2)) / max(np.sqrt(np.mean(mid ** 2)), EPS)),
        'mono_fold_down_db': db(np.sqrt(np.mean(mid ** 2)) / max(rms, EPS)),
        'spectral_centroid_hz': float(np.sum(frequencies[audible] * psd[audible]) / max(power, EPS)),
        'band_energy_fraction': bands,
        'strongest_local_1k_5k_peak': {'hz': float(frequencies[narrow_index]), 'db_above_local_median': float(prominence[narrow_index])},
        'active_100ms_rms_p95_minus_p05_db': db(np.percentile(active, 95)) - db(np.percentile(active, 5)),
        'texture_recurrence_below_1khz': recurrence,
        'strongest_texture_recurrences': [{'lag_seconds': float(lags[i] / 2000), 'correlation': float(values[i])} for i in strongest],
        'envelope': {'step_seconds': 0.1, 'rms_dbfs': [db(value) for value in envelope]},
        'spectrum': {'hz': frequencies[audible].tolist(), 'dbfs_per_hz': (10 * np.log10(psd[audible] + EPS)).tolist()},
    }
    return metrics


def match_pair(raw, before, candidate, destination, target=-23, ceiling=-3):
    # Pick one common loudness low enough that BOTH sources stay below the
    # true-peak ceiling with static gain only. This avoids changing dynamics
    # or adding a limiter that would confound the listening comparison.
    members = [before, candidate] if candidate is not None else [before]
    common = min([target] + [m['loudness']['integrated_lufs'] + ceiling - m['loudness']['true_peak_dbtp'] for m in members])
    normalized = {}
    for member in members:
        gain_db = common - member['loudness']['integrated_lufs']
        output = destination / member['file']
        subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(raw / member['file']),
                        '-af', f'volume={gain_db:.6f}dB,aresample=osf=s16:dither_method=triangular',
                        '-c:a', 'pcm_s16le', str(output)], check=True)
        checked = loudness(output)
        if checked['true_peak_dbtp'] > ceiling + 0.1:
            raise ValueError(f'{output}: matched copy exceeds true-peak ceiling')
        if abs(checked['integrated_lufs'] - common) > 0.2:
            raise ValueError(f'{output}: loudness mismatch after static gain')
        normalized[member['file']] = {'gain_db': gain_db, **checked}
    return {'target_lufs': common, 'true_peak_ceiling_dbtp': ceiling, 'method': 'static gain, no compression/limiting', 'files': normalized}


def plot_scene(scene, metrics, figures):
    # Bundled fonts keep labels consistent and avoid macOS system_profiler's
    # potentially lengthy installed-font discovery on first use.
    import matplotlib.pyplot as plt
    fig, axes = plt.subplots(2, 1, figsize=(11, 7), layout='constrained')
    for version, color in [('before', '#b45950'), ('candidate', '#197f9b')]:
        if version not in scene['files']:
            continue
        item = metrics[scene['files'][version]['filename']]
        spectrum, envelope = item['spectrum'], item['envelope']
        axes[0].semilogx(spectrum['hz'], spectrum['dbfs_per_hz'], label=version, color=color, linewidth=1)
        axes[1].plot(np.arange(len(envelope['rms_dbfs'])) * 0.1, envelope['rms_dbfs'], label=version, color=color, linewidth=1.3)
    axes[0].set(xlim=(20, 20000), ylim=(-115, -20), ylabel='Power spectral density (dBFS/Hz)', title=scene['title'] + ' — raw delivered mix')
    axes[1].set(xlim=(0, scene['duration']), ylim=(-90, 0), xlabel='Time (seconds)', ylabel='100 ms RMS (dBFS)')
    for at, label in scene.get('markers', []):
        axes[1].axvline(at, alpha=0.15, color='black')
        axes[1].text(at + 0.07, -4, label, rotation=90, fontsize=8, va='top', color='#444444')
    for axis in axes:
        axis.grid(alpha=0.2)
        axis.legend(loc='lower right')
    fig.savefig(figures / f'{scene["id"]}.png', dpi=160)
    fig.savefig(figures / f'{scene["id"]}.svg')
    plt.close(fig)


def write_report(batch, manifest, report):
    lines = [f'# Raptor audio capture: {manifest["batch"]}', '',
             'These are signal measurements and prepared listening stimuli, not a claim that a human has listened or that higher/lower metric values prove better sound.', '',
             '## Measurement conditions', '',
             f'- {manifest["sampleRate"]} Hz, stereo, 32-bit float raw WAV; seeded browser OfflineAudioContext; {manifest["warmupSeconds"]} seconds warmup excluded.',
             '- Analysis uses FFmpeg EBU R128/BS.1770 loudness and oversampled true-peak reporting. Short clips are not judged using Loudness Range.',
             '- Each blind pair uses the same integrated loudness (normally −23 LUFS) with a −3 dBTP ceiling. Static gain preserves each source’s dynamics; a lower common target is used if necessary.',
             '- Spectra and autocorrelation are diagnostic descriptions. They do not quantify realism, fatigue, masking, or listening preference.',
             f'- Baseline adapter: {manifest["baselineAdapter"]}', f'- Scope: {manifest["limitations"]}', '',
             '## Raw mix measurements', '',
             '| Scene | Version | LUFS | dBTP | Crest dB | Stereo correlation | Mono fold dB | 1–4 kHz energy |',
             '|---|---|---:|---:|---:|---:|---:|---:|']
    for scene in manifest['scenes']:
        for version in scene['files']:
            m = report['files'][scene['files'][version]['filename']]
            lines.append(f'| {scene["id"]} | {version} | {m["loudness"]["integrated_lufs"]:.2f} | {m["loudness"]["true_peak_dbtp"]:.2f} | {m["crest_db"]:.2f} | {m["left_right_correlation"]:.3f} | {m["mono_fold_down_db"]:.2f} | {100*m["band_energy_fraction"]["1000-4000"]:.1f}% |')
    if report['individual_stimuli']:
        lines += ['', '## Individual world scenes', '',
                  'These scenes have no equivalent original implementation. The prepared clips are labeled individual stimuli, not a blind A/B comparison or proof of improvement.', '']
        for scene in manifest['scenes']:
            if scene['id'] in report['individual_stimuli']:
                name = next(iter(scene['files'].values()))['filename']
                lines.append(f'- [{scene["title"]}](matched/{name})')
    lines += ['', '## Listening protocol', '',
              '1. Open `blind/index.html` through the local authoring server. Begin at a comfortable fixed playback level.',
              '2. Compare A and B before revealing labels. Switch at the same timeline position; repeat short sections. Record preferences and concrete notes for body, harshness, mechanical texture, alert separation, and repetition.',
              '3. Listen once in stereo and once with the common mono control. Repeat on headphones and a small speaker if available; log the playback system.',
              '4. Use the raw files at a common playback gain afterward to assess actual in-game dynamics and overall mix balance.',
              '5. Reveal only after recording impressions. Export the notes; a revealed session is explicitly marked unblinded.', '',
              'No human preferences are prefilled. Automated audio critiques need an identical-input control and order reversal before comparative judgments can be trusted. The model used in this production pass failed an identical-input control; its comparative preferences are excluded from acceptance evidence.', '',
              '## Sources', '',
              '- [FFmpeg loudnorm](https://ffmpeg.org/ffmpeg-filters.html#loudnorm): integrated-loudness and true-peak measurement.',
              '- [EBU R128](https://tech.ebu.ch/docs/r/r128.pdf): loudness measurement framework; cautions against interpreting LRA for programs shorter than one minute.', '',
              '## Figures', '']
    for scene in manifest['scenes']:
        if (batch / 'figures' / f'{scene["id"]}.png').exists():
            lines += [f'### {scene["title"]}', '', f'![Raw spectrum and envelope](figures/{scene["id"]}.png)', '']
    (batch / 'report.md').write_text('\n'.join(lines))


def main():
    parser = ArgumentParser(description=__doc__)
    parser.add_argument('batch', type=Path, help='Capture directory containing raw/manifest.json')
    parser.add_argument('--workers', type=int, default=2)
    parser.add_argument('--no-plots', action='store_true', help='Author listening copies and metrics without loading the plotting backend')
    args = parser.parse_args()
    batch = args.batch.resolve()
    raw = batch / 'raw'
    manifest = json.loads((raw / 'manifest.json').read_text())
    scenes = manifest['scenes']
    matched, blind, figures = [batch / name for name in ['matched', 'blind', 'figures']]
    for directory in [matched, blind, figures]:
        directory.mkdir(exist_ok=True)
    paths = [raw / item['filename'] for scene in scenes for item in scene['files'].values()]
    print(f'Measuring {len(paths)} WAVs', flush=True)
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        metrics = dict(zip([p.name for p in paths], pool.map(measure, paths)))
    report = {'capture': manifest, 'tools': {'numpy': np.__version__, 'matplotlib': matplotlib.__version__,
              'ffmpeg': subprocess.run(['ffmpeg', '-version'], capture_output=True, text=True).stdout.splitlines()[0]},
              'files': metrics, 'matched_pairs': {}, 'individual_stimuli': {}}
    review = {'batch': manifest['batch'], 'captured_at': manifest['recordedAt'], 'scenes': []}
    key = {'batch': manifest['batch'], 'scenes': {}}
    for scene in scenes:
        print(f'Authoring {scene["id"]}', flush=True)
        if not all(v in scene['files'] for v in ['before', 'candidate']):
            member = metrics[next(iter(scene['files'].values()))['filename']]
            report['individual_stimuli'][scene['id']] = match_pair(raw, member, None, matched)
            continue
        before, candidate = [metrics[scene['files'][v]['filename']] for v in ['before', 'candidate']]
        report['matched_pairs'][scene['id']] = match_pair(raw, before, candidate, matched)
        versions = ['before', 'candidate'] if secrets.randbelow(2) else ['candidate', 'before']
        files = {}
        for label, version in zip(['A', 'B'], versions):
            filename = f'{scene["id"]}-{label.lower()}.wav'
            shutil.copyfile(matched / scene['files'][version]['filename'], blind / filename)
            files[label] = filename
        key['scenes'][scene['id']] = dict(zip(['A', 'B'], versions))
        review['scenes'].append({k: scene[k] for k in ['id', 'title', 'duration', 'purpose', 'markers'] if k in scene} | {'files': files})
    if not args.no_plots:
        for scene in scenes:
            plot_scene(scene, metrics, figures)
    (batch / 'analysis.json').write_text(json.dumps(report, indent=2, allow_nan=False))
    (blind / 'review.json').write_text(json.dumps(review, indent=2))
    (blind / 'key.json').write_text(json.dumps(key, indent=2))
    if review['scenes']:
        shutil.copyfile(Path(__file__).with_name('audition.html'), blind / 'index.html')
    write_report(batch, manifest, report)
    print(f'Report: {batch / "report.md"}', flush=True)
    if review['scenes']:
        print(f'Blind audition: {blind / "index.html"}', flush=True)


if __name__ == '__main__':
    main()
