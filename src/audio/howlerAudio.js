// audio/howlerAudio.js
function _isBrowser() {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

async function _decodeAudioData(ctx, ab) {
  return await new Promise((resolve, reject) => {
    try {
      const p = ctx.decodeAudioData(ab, resolve, reject);
      if (p && typeof p.then === "function") p.then(resolve, reject);
    } catch (e) {
      reject(e);
    }
  });
}

function _coerceFile(fileLike) {
  if (!fileLike) return null;
  if (typeof File !== "undefined" && fileLike instanceof File) return fileLike;

  const files = fileLike && fileLike.files;
  if (files && typeof files.length === "number") return files[0] || null;

  if (Array.isArray(fileLike)) return fileLike[0] || null;

  if (typeof FileList !== "undefined" && fileLike instanceof FileList) return fileLike[0] || null;

  return fileLike;
}

async function _fileToArrayBuffer(file) {
  if (file && typeof file.arrayBuffer === "function") return await file.arrayBuffer();

  return await new Promise((resolve, reject) => {
    try {
      const fr = new FileReader();
      fr.onerror = () => reject(new Error("FileReader failed."));
      fr.onload = () => resolve(fr.result);
      fr.readAsArrayBuffer(file);
    } catch (e) {
      reject(e);
    }
  });
}

async function _fetchArrayBufferDefault(url) {
  const res = await fetch(String(url), { mode: "cors", credentials: "same-origin" });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText || ""}`.trim());
  return await res.arrayBuffer();
}

export function createHowlerAudioController({ ensureHowlerWorklet, Howler, fetchArrayBuffer } = {}) {
  if (!_isBrowser()) throw new Error("Browser environment required.");
  if (typeof ensureHowlerWorklet !== "function") throw new Error("ensureHowlerWorklet required.");
  if (!Howler) throw new Error("Howler required. Import it and pass it in.");

  const state = {
    ctx: null,
    api: null,
    analyser: null,

    osc: null,
    oscGain: null,
    bufSrc: null,
    mediaSrc: null,
    mediaStream: null,

    fetchArrayBuffer: typeof fetchArrayBuffer === "function" ? fetchArrayBuffer : null,
    currentBuffer: null,
    currentLoop: false,
    currentStartedAt: 0,
    currentOffset: 0,
    currentDuration: 0,
    outputGain: 0.5,
    fxGain: 1,
  };

  function _stopNodes() {
    if (state.osc) {
      try {
        state.osc.stop();
      } catch (e) {console.error(e);}
      try {
        state.osc.disconnect();
      } catch (e) {console.error(e);}
      state.osc = null;
    }
    if (state.oscGain) {
      try {
        state.oscGain.disconnect();
      } catch (e) {console.error(e);}
      state.oscGain = null;
    }
    if (state.bufSrc) {
      try {
        state.bufSrc.stop();
      } catch (e) {console.error(e);}
      try {
        state.bufSrc.disconnect();
      } catch (e) {console.error(e);}
      state.bufSrc = null;
    }
    if (state.mediaSrc) {
      try {
        state.mediaSrc.disconnect();
      } catch (e) {console.error(e);}
      state.mediaSrc = null;
    }
    if (state.mediaStream) {
      try {
        for (const tr of state.mediaStream.getTracks()) tr.stop();
      } catch (e) {console.error(e);}
      state.mediaStream = null;
    }
  }

  async function init({ analyser, outputGain, fxGain, sharedTap } = {}) {
    if (state.api) return;

    state.api = await ensureHowlerWorklet(null, {
      Howler,
      useAnalyser: true,
      meterEnabled: false,
      analyser: analyser || { fftSize: 1024, smoothingTimeConstant: 0.0 },
      sharedTap: sharedTap || null,
    });

    state.ctx = state.api.ctx;
    state.analyser = state.api.analyser;

    try {
      if (state.ctx && typeof state.ctx.resume === "function") await state.ctx.resume();
    } catch (e) {console.error(e);}

    setOutputGain(outputGain);
    setFxGain(fxGain);
  }

  async function playOsc({ hz, gain, outputGain, fxGain } = {}) {
    if (!state.api || !state.ctx) throw new Error("init() first");

    _stopNodes();

    setOutputGain(outputGain);
    setFxGain(fxGain);

    const ctx = state.ctx;

    const freq = Number.isFinite(hz) ? Math.max(10, Math.min(24000, hz)) : 440;
    const g = Number.isFinite(gain) ? Math.max(0, Math.min(1, gain)) : 0.12;

    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, ctx.currentTime);

    const gn = ctx.createGain();
    gn.gain.setValueAtTime(g, ctx.currentTime);

    const inG = state.api.createInputGain(1);
    osc.connect(gn);
    gn.connect(inG);

    osc.start();

    state.osc = osc;
    state.oscGain = gn;
  }

  function _startDecodedBuffer(buf, { loop = false, offset = 0, outputGain, fxGain } = {}) {
    if (!state.api || !state.ctx) throw new Error("init() first");
    if (!buf) throw new Error("decoded buffer required");

    _stopNodes();

    if (outputGain !== undefined) setOutputGain(outputGain);
    else setOutputGain(state.outputGain);
    if (fxGain !== undefined) setFxGain(fxGain);
    else setFxGain(state.fxGain);

    const ctx = state.ctx;
    const dur = Number(buf.duration) || 0;
    const off = dur > 0 ? Math.max(0, Math.min(dur - 0.01, Number(offset) || 0)) : 0;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = !!loop;

    const inG = state.api.createInputGain(1);
    src.connect(inG);

    try { src.start(0, off); } catch (e) { src.start(); }

    state.bufSrc = src;
    state.currentBuffer = buf;
    state.currentLoop = !!loop;
    state.currentStartedAt = ctx.currentTime || 0;
    state.currentOffset = off;
    state.currentDuration = dur;
    src.onended = () => {
      if (state.bufSrc === src) state.bufSrc = null;
    };
  }

  async function playMp3({ url, loop, outputGain, fxGain } = {}) {
    if (!state.api || !state.ctx) throw new Error("init() first");

    const ctx = state.ctx;

    const fetchAB = state.fetchArrayBuffer || _fetchArrayBufferDefault;
    const ab = await fetchAB(String(url), { method: "GET" });

    const buf = await _decodeAudioData(ctx, ab.slice(0));
    _startDecodedBuffer(buf, { loop, outputGain, fxGain, offset: 0 });
  }

  async function playUrl({ url, loop, outputGain, fxGain } = {}) {
    return await playMp3({ url, loop, outputGain, fxGain });
  }

  async function playFile({ file, loop, outputGain, fxGain } = {}) {
    if (!state.api || !state.ctx) throw new Error("init() first");

    const f = _coerceFile(file);
    if (!f) throw new Error("file required.");

    const ctx = state.ctx;

    const ab = await _fileToArrayBuffer(f);
    const buf = await _decodeAudioData(ctx, ab.slice(0));
    _startDecodedBuffer(buf, { loop, outputGain, fxGain, offset: 0 });
  }


  async function playMediaStream({ stream, outputGain, fxGain, monitor = false } = {}) {
    if (!state.api || !state.ctx) throw new Error("init() first");
    if (!stream || typeof stream.getTracks !== "function") throw new Error("stream required.");

    _stopNodes();

    setOutputGain(monitor ? outputGain : 0);
    setFxGain(fxGain);

    const ctx = state.ctx;
    const src = ctx.createMediaStreamSource(stream);
    const inG = state.api.createInputGain(1);
    src.connect(inG);

    state.mediaSrc = src;
    state.mediaStream = stream;
  }

  function stop() {
    _stopNodes();
    state.currentBuffer = null;
    state.currentDuration = 0;
    state.currentOffset = 0;
  }

  function shutdown() {
    _stopNodes();
  }

  function setOutputGain(v) {
    const x = Number(v);
    if (Number.isFinite(x)) state.outputGain = x;
    try {
      if (state.api && Number.isFinite(x)) state.api.setOutputGain(x);
    } catch (e) {console.error(e);}
  }

  function setFxGain(v) {
    const x = Number(v);
    if (Number.isFinite(x)) state.fxGain = x;
    try {
      if (state.api && Number.isFinite(x)) state.api.setFxGain(x);
    } catch (e) {console.error(e);}
  }

  function setFetchArrayBuffer(fn) {
    state.fetchArrayBuffer = typeof fn === "function" ? fn : null;
  }

  function getAnalyser() {
    return state.analyser;
  }

  function getSharedTap() {
    return state.api && state.api.sharedTap ? state.api.sharedTap : null;
  }

  function getApi() {
    return state.api;
  }

  function getCtxState() {
    return state.ctx ? String(state.ctx.state || "unknown") : "none";
  }

  function getSampleRate() {
    return state.ctx ? state.ctx.sampleRate || 0 : 0;
  }

  async function pause() {
    if (!state.ctx || typeof state.ctx.suspend !== "function") return false;
    try {
      if (state.ctx.state === "running") await state.ctx.suspend();
      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
  }

  async function resume() {
    if (!state.ctx || typeof state.ctx.resume !== "function") return false;
    try {
      if (state.ctx.state !== "running") await state.ctx.resume();
      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
  }


  function seek(seconds) {
    if (!state.currentBuffer || !state.ctx) return false;
    _startDecodedBuffer(state.currentBuffer, { loop: state.currentLoop, offset: Math.max(0, Number(seconds) || 0) });
    return true;
  }

  function getTransport() {
    const duration = Number(state.currentDuration) || 0;
    if (!duration || !state.currentBuffer || !state.ctx) return { seekable: false, currentTime: 0, duration: 0, paused: state.ctx ? state.ctx.state !== "running" : false };
    let currentTime = (Number(state.currentOffset) || 0) + Math.max(0, (state.ctx.currentTime || 0) - (state.currentStartedAt || 0));
    if (state.currentLoop && duration > 0) currentTime = currentTime % duration;
    else currentTime = Math.min(duration, currentTime);
    return { seekable: true, currentTime, duration, loop: !!state.currentLoop, paused: state.ctx ? state.ctx.state !== "running" : false };
  }

  return {
    init,
    playOsc,
    playMp3,
    playUrl,
    playFile,
    stop,
    shutdown,
    setOutputGain,
    setFxGain,
    setFetchArrayBuffer,
    playMediaStream,
    getAnalyser,
    getApi,
    getCtxState,
    getSampleRate,
    pause,
    resume,
    seek,
    getTransport,
  };
}