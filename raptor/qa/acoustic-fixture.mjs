// Native scheduling fixture: exercises the production scene and voice classes
// without a browser, audio device, PCM rendering or timing-dependent callbacks.
export class AcousticContext {
  constructor({ record = true } = {}) {
    this.currentTime = 0; this.sampleRate = 1000;
    this.events = record ? [] : null; this.nodes = [];
    this.destination = { id: 'output' };
    this.listener = this.node('listener', ['positionX', 'positionY', 'positionZ',
      'forwardX', 'forwardY', 'forwardZ', 'upX', 'upY', 'upZ']);
  }
  node(kind, parameters = []) {
    const ctx = this, id = `${kind}:${this.nodes.length}`;
    const node = { id,
      connect(to) { ctx.events?.push([id, 'connect', to.id]); return to; },
      disconnect() { ctx.events?.push([id, 'disconnect']); },
      start(...args) { ctx.events?.push([id, 'start', ...args]); },
      stop(...args) { ctx.events?.push([id, 'stop', ...args]); },
    };
    for (const key of parameters) node[key] = { value: 0,
      setTargetAtTime(value, time, tau) { this.value = value; ctx.events?.push([id, key, value, time, tau]); },
      cancelAndHoldAtTime(time) { ctx.events?.push([id, key, 'hold', time]); },
    };
    this.nodes.push(node); return node;
  }
  createGain() { return this.node('gain', ['gain']); }
  createBiquadFilter() { return this.node('filter', ['frequency', 'Q']); }
  createPanner() { return this.node('panner', ['positionX', 'positionY', 'positionZ', 'orientationX', 'orientationY', 'orientationZ']); }
  createBufferSource() { return this.node('buffer', ['playbackRate']); }
  createOscillator() { return this.node('oscillator', ['frequency']); }
  createBuffer(channels, length, sampleRate) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { duration: length / sampleRate, getChannelData: channel => data[channel] };
  }
}
