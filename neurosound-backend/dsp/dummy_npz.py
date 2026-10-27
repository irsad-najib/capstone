#!/usr/bin/env python3
"""Baca rekaman dummy ABR (.npz dari abr/abr_dummy.py) untuk replay di backend.

  dummy_npz.py --list DIR      -> JSON daftar rekaman + ground truth per level
  dummy_npz.py FILE --fs 16000 -> 1 baris JSON header, lalu n float32 LE (µV)
  dummy_npz.py --info -        -> JSON info satu .npz dari stdin (untuk upload ke MongoDB)
  dummy_npz.py --gt -          -> ground_truth.json dari stdin, diringkas per level

FILE = "-" berarti isi .npz dibaca dari stdin (rekaman dari GridFS).

Rekaman di-resample ke fs backend supaya latensi gelombang tetap benar.
"""
import argparse
import glob
import io
import json
import os
import sys
from fractions import Fraction

import numpy as np
from scipy.signal import resample_poly


def ground_truth(directory):
    path = os.path.join(directory, "ground_truth.json")
    if not os.path.exists(path):
        return {}
    with open(path) as f:
        return summarize_gt(json.load(f))


def summarize_gt(gt):
    out = {}
    for level, v in gt.get("levels", {}).items():
        art = v.get("artifact_sweeps", {})
        out[int(level)] = {
            "waves": {k: {"latency_ms": w["latency_ms"], "amplitude_uv": w["amplitude_uv"]}
                      for k, w in (v.get("waves") or {}).items() if w},
            "artifact_sweeps": sum(len(x) for x in art.values()),
        }
    return {"threshold_db": gt.get("threshold_db"), "levels": out}


def open_npz(path):
    if path == "-":
        return np.load(io.BytesIO(sys.stdin.buffer.read()))
    return np.load(path)


def info(d):
    fs = float(d["fs"])
    return {
        "level_db": int(d["level_db"]) if "level_db" in d.files else None,
        "fs": fs,
        "sweeps": int(d["trig_idx"].size),
        "duration_s": round(d["signal_uv"].size / fs, 1),
    }


def list_dir(directory):
    gt = ground_truth(directory)
    items = []
    for path in sorted(glob.glob(os.path.join(directory, "*.npz"))):
        with np.load(path) as d:
            item = {"file": os.path.basename(path), **info(d)}
        item["ground_truth"] = gt.get("levels", {}).get(item["level_db"])
        items.append(item)
    items.sort(key=lambda x: -(x["level_db"] or 0))
    json.dump({"threshold_db": gt.get("threshold_db"), "recordings": items}, sys.stdout)


def dump(path, fs_out):
    with open_npz(path) as d:
        fs = float(d["fs"])
        x = d["signal_uv"].astype(np.float64)
        trig = d["trig_idx"].astype(np.int64)
        level = int(d["level_db"]) if "level_db" in d.files else None
    if fs != fs_out:
        ratio = Fraction(fs_out / fs).limit_denominator(1000)
        x = resample_poly(x, ratio.numerator, ratio.denominator)
        trig = np.round(trig * fs_out / fs).astype(np.int64)
    trig = trig[(trig >= 0) & (trig < x.size)]
    header = {"fs": fs_out, "n": int(x.size), "level_db": level, "trig": trig.tolist()}
    out = sys.stdout.buffer
    out.write((json.dumps(header) + "\n").encode())
    out.write(x.astype("<f4").tobytes())
    out.flush()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("path")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--info", action="store_true")
    ap.add_argument("--gt", action="store_true")
    ap.add_argument("--fs", type=int, default=16000)
    a = ap.parse_args()
    if a.list:
        list_dir(a.path)
    elif a.info:
        with open_npz(a.path) as d:
            json.dump(info(d), sys.stdout)
    elif a.gt:
        src = sys.stdin if a.path == "-" else open(a.path)
        json.dump(summarize_gt(json.load(src)), sys.stdout)
    else:
        dump(a.path, a.fs)


if __name__ == "__main__":
    main()
