// RAPTOR voice (phase 13 VOICE SPIKE): the ~400 radio lines get a voice via
// window.speechSynthesis. RENDER-SIDE ONLY — nothing here touches sim state,
// draws rng, or is hashed; the comms ring stays ids-and-times and this module
// watches it from outside (hookComms polls script.commsHead, exactly like the
// HUD reads readComms()).
//
// Casting (2026-08-09 spike, headed Chrome on macOS — 180 voices exposed, all
// localService, no network voices): OVERLORD rides Daniel (en-GB) measured
// and pitched down; the player rides Samantha (en-US, the machine's default
// and its best voice); ace guard-channel taunts ride Ralph (en-US) slowed and
// dropped to pitch 0.55 — three maximally distinct voices from the stock
// roster. Preference lists carry cross-platform fallbacks (Alex/Aaron/Google
// voices) and degrade to "first local en-*", then the engine default.
//
// Honesty: utterance telemetry proved synthesis end-to-end (plausible
// durations, word-boundary events, zero errors) but nobody with ears has
// judged the result — the settings toggle ships DEFAULT OFF until then.
//
// Contract: Voice.speak(lineId, text) infers the speaker from the subtitle's
// own prefix ("OVERLORD:" / "RAPTOR 1-1:" / ace names ± "(guard)" / "??"),
// strips it (plus taunt quotes) for speech, and keeps at most TWO utterances
// in flight (one speaking + one waiting; a newer line replaces the waiting
// one) — the radio never talks over itself and never builds a backlog.
// Everything no-ops cleanly when speechSynthesis is absent.

const ACE_NAMES = new Set(["TYPHOON", "JACKAL", "BOREAS", "SHRIKE", "VIPER", "??"]);

// per-speaker delivery + voice preference (first installed match wins)
export const SPEAKERS = {
  OVERLORD: { rate: 0.92, pitch: 0.75, prefer: ["Daniel", "Alex", "Aaron", "Google UK English Male", "Fred"] },
  RAPTOR:   { rate: 1.0,  pitch: 1.0,  prefer: ["Samantha", "Google US English", "Karen", "Victoria"] },
  ACE:      { rate: 0.82, pitch: 0.55, prefer: ["Ralph", "Fred", "Daniel", "Google UK English Male"] },
};

// urgency variant: MISSILE-adjacent calls speed up a notch. Aces are exempt —
// an ace is never hurried.
const URGENT = /\bmissile\b|fight'?s on\b|\bdefend\b/i;
const URGENT_RATE = 1.15;

// "CALLSIGN:" or "CALLSIGN (guard):" — ALLCAPS prefixes only, so briefing
// prose that happens to open "Be advised:" / "The math is unforgiving:" is
// narrated whole (mixed case never matches).
const PREFIX_RE = /^([A-Z?][A-Z0-9 ?-]{0,18}?)(\s*\(guard\))?:\s*/;

// speaker + speech text from a subtitle. Exported for QA.
export function inferSpeaker(text) {
  const m = PREFIX_RE.exec(text);
  if (!m) return { who: "OVERLORD", clean: text }; // unprefixed briefing prose -> controller cadence
  const name = m[1].trim().replace(/\s+\d.*$/, ""); // "RAPTOR 1-1" -> "RAPTOR"
  const who = ACE_NAMES.has(name) ? "ACE" : name === "RAPTOR" ? "RAPTOR" : "OVERLORD";
  let clean = text.slice(m[0].length);
  if (who === "ACE") clean = clean.replace(/^'/, "").replace(/'$/, ""); // taunts arrive quoted
  return { who, clean };
}

export class Voice {
  // settingsLike: anything with current() -> { voice, uiVol } (the settings
  // module itself qualifies). opts.{synth,Utterance} exist for QA injection;
  // both default to the real browser globals and to null where absent.
  constructor(settingsLike, opts = {}) {
    this.settings = settingsLike;
    this.synth = "synth" in opts ? opts.synth
      : (typeof window !== "undefined" && window.speechSynthesis) || null;
    this.U = "Utterance" in opts ? opts.Utterance
      : (typeof window !== "undefined" && window.SpeechSynthesisUtterance) || null;
    this._cur = null;   // item speaking now
    this._next = null;  // single waiting slot (newest wins) -> queue caps at 2
    this._cast = null;  // speaker -> SpeechSynthesisVoice, resolved lazily
  }

  enabled() {
    if (!this.synth || !this.U) return false;
    const s = this.settings && this.settings.current ? this.settings.current() : this.settings;
    return !!(s && s.voice);
  }

  _vol() {
    const s = this.settings && this.settings.current ? this.settings.current() : this.settings;
    const v = s && typeof s.uiVol === "number" ? s.uiVol : 1;
    return Math.min(1, Math.max(0, v));
  }

  // voices load async in Chrome — retry the cast until getVoices() answers;
  // until then utterances go out voiceless (engine default still speaks).
  _voiceFor(who) {
    if (!this._cast) {
      const all = (this.synth.getVoices && this.synth.getVoices()) || [];
      if (!all.length) return null;
      this._cast = {};
      for (const [name, cfg] of Object.entries(SPEAKERS)) {
        let v = null;
        for (const want of cfg.prefer) { v = all.find((x) => x.name === want) || null; if (v) break; }
        if (!v) v = all.find((x) => /^en/.test(x.lang) && x.localService) || all.find((x) => /^en/.test(x.lang)) || null;
        this._cast[name] = v;
      }
    }
    return this._cast[who] || null;
  }

  speak(lineId, text) {
    if (!text || !this.enabled()) return;
    const { who, clean } = inferSpeaker(text);
    const item = { lineId, who, clean };
    if (this._cur) { this._next = item; return; } // waiting slot: newest wins
    this._start(item);
  }

  _start(item) {
    this._cur = item;
    const cfg = SPEAKERS[item.who];
    const u = new this.U(item.clean);
    const v = this._voiceFor(item.who);
    if (v) u.voice = v;
    u.rate = cfg.rate * (item.who !== "ACE" && URGENT.test(item.clean) ? URGENT_RATE : 1);
    u.pitch = cfg.pitch;
    u.volume = this._vol();
    const done = () => {
      if (this._cur !== item) return; // cancelled/superseded — a newer chain owns the queue
      this._cur = null;
      const n = this._next;
      this._next = null;
      if (n && this.enabled()) this._start(n);
    };
    u.onend = done;
    u.onerror = done;
    try { this.synth.speak(u); } catch (_) { done(); }
  }

  cancel() {
    this._cur = null;
    this._next = null;
    if (this.synth && this.synth.cancel) { try { this.synth.cancel(); } catch (_) {} }
  }
}

// Watches script.commsHead and speaks NEW ring entries only — dedupe rides
// the monotonic head counter, so HUD rerenders can never re-speak a line.
// A head that moved BACKWARD is a mission reset -> cancel mid-sentence and
// re-arm from zero. Reset detection can't ride the counter alone: script.
// reset() zeroes the head and refired triggers climb it back between polls
// (live-probed: reset + ON_START refire aliased head right back onto the
// cursor and the line was lost) — so the newest CONSUMED entry's sim-time
// stamp is remembered too; a rebuilt ring betrays itself by fresh stamps at
// old positions. While the toggle is off the cursor keeps advancing, so
// re-enabling doesn't replay the backlog. intervalMs > 0 installs its own
// poll timer; intervalMs: 0 hands the orchestrator a poll() to call per
// frame. Returns { poll, stop }.
export function hookComms(script, missionData, voice, { intervalMs = 300 } = {}) {
  let last = script.commsHead; // entries consumed (hooked mid-mission = skip the backlog)
  let lastStamp = last > 0 ? script.readComms()[0].t : -1;
  let wasOn = false;
  const poll = () => {
    const head = script.commsHead;
    const on = voice.enabled();
    if (!on) {
      if (wasOn) voice.cancel(); // toggle flipped off mid-line -> radio silence now
      wasOn = false;
      last = head;
      lastStamp = head > 0 ? script.readComms()[0].t : -1;
      return;
    }
    wasOn = true;
    const ring = script.readComms(); // newest-first
    if (head < last) { voice.cancel(); last = 0; } // reset caught mid-climb
    else if (head > last) {
      // the entry just below the fresh window must be the one consumed last;
      // a fresh stamp there = the ring was rebuilt under us -> all is new
      const below = ring[head - last];
      if (last > 0 && below && below.t !== lastStamp) { voice.cancel(); last = 0; }
    } else if (head > 0 && ring[0] && ring[0].t !== lastStamp) {
      voice.cancel(); last = 0; // aliased head: same count, new words
    }
    if (head > last) {
      const fresh = ring.slice(0, head - last);
      for (let i = fresh.length - 1; i >= 0; i--) {
        const text = missionData.lines[fresh[i].lineId];
        if (text) voice.speak(fresh[i].lineId, text);
      }
      last = head;
      lastStamp = ring[0].t;
    }
  };
  const timer = intervalMs > 0 ? setInterval(poll, intervalMs) : null;
  return { poll, stop: () => { if (timer) clearInterval(timer); voice.cancel(); } };
}
