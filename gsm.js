// GSM 06.10 (Microsoft WAV49, format tag 49) -> 16-bit PCM WAV. Browsers can't play these.
const GapGsm = (() => {
  const sat = (x) => (x > 32767 ? 32767 : x < -32768 ? -32768 : x);
  const add = (a, b) => sat(a + b);
  const sub = (a, b) => sat(a - b);
  const mult = (a, b) => (a === -32768 && b === -32768 ? 32767 : (a * b) >> 15);
  const multR = (a, b) => (a === -32768 && b === -32768 ? 32767 : (a * b + 16384) >> 15);

  const INVA = [13107, 13107, 13107, 13107, 19223, 17476, 31454, 29708];
  const MIC = [-32, -32, -16, -16, -8, -8, -4, -4];
  const B = [0, 0, 2048, -2560, 94, -1792, -341, -1144];
  const FAC = [18431, 20479, 22527, 24575, 26623, 28671, 30719, 32767];
  const QLB = [3277, 11469, 21299, 32767];
  const LAR_BITS = [6, 6, 5, 5, 4, 4, 3, 3];

  function readFrame(br) {
    const f = { LARc: [], Nc: [], bc: [], Mc: [], xmaxc: [], xMc: [] };
    for (let i = 0; i < 8; i++) f.LARc.push(br(LAR_BITS[i]));
    for (let j = 0; j < 4; j++) {
      f.Nc.push(br(7)); f.bc.push(br(2)); f.Mc.push(br(2)); f.xmaxc.push(br(6));
      const x = [];
      for (let i = 0; i < 13; i++) x.push(br(3));
      f.xMc.push(x);
    }
    return f;
  }

  function createDecoder() {
    const drp = new Int32Array(280);
    const v = new Int32Array(9);
    const prevLARpp = new Int32Array(8);
    const curLARpp = new Int32Array(8);
    let nrp = 40;
    let msr = 0;

    function larToRp(larp) {
      const rp = new Int32Array(8);
      for (let i = 0; i < 8; i++) {
        let t = larp[i];
        const neg = t < 0;
        if (neg) t = t === -32768 ? 32767 : -t;
        t = t < 11059 ? t << 1 : t < 20070 ? t + 11059 : add(t >> 2, 26112);
        rp[i] = neg ? -t : t;
      }
      return rp;
    }

    return function decodeFrame(f, out, o) {
      const erp = new Int32Array(40);
      for (let j = 0; j < 4; j++) {
        const xmaxc = f.xmaxc[j];
        let exp = 0;
        if (xmaxc > 15) exp = (xmaxc >> 3) - 1;
        let mant = xmaxc - (exp << 3);
        if (mant === 0) { exp = -4; mant = 7; }
        else { while (mant <= 7) { mant = (mant << 1) | 1; exp--; } mant -= 8; }
        const t1 = FAC[mant], t2 = 6 - exp, t3 = 1 << (t2 - 1);
        erp.fill(0);
        for (let i = 0; i < 13; i++) {
          let t = (f.xMc[j][i] << 1) - 7;
          t <<= 12;
          t = multR(t1, t);
          t = add(t, t3);
          erp[f.Mc[j] + 3 * i] = t >> t2;
        }
        const nc = f.Nc[j];
        const nr = nc < 40 || nc > 120 ? nrp : nc;
        nrp = nr;
        const brp = QLB[f.bc[j]];
        const off = 120 + 40 * j;
        for (let k = 0; k < 40; k++) drp[off + k] = add(erp[k], multR(brp, drp[off + k - nr]));
      }
      const wt = drp.slice(120, 280);
      for (let k = 0; k < 120; k++) drp[k] = drp[k + 160];

      for (let i = 0; i < 8; i++) {
        let t = add(f.LARc[i], MIC[i]) << 10;
        t = sub(t, B[i] << 1);
        t = multR(INVA[i], t);
        curLARpp[i] = add(t, t);
      }
      const segs = [[0, 12], [13, 26], [27, 39], [40, 159]];
      const larp = new Int32Array(8);
      for (let s = 0; s < 4; s++) {
        for (let i = 0; i < 8; i++) {
          const p = prevLARpp[i], c = curLARpp[i];
          larp[i] = s === 0 ? add(add(p >> 2, c >> 2), p >> 1)
            : s === 1 ? add(p >> 1, c >> 1)
            : s === 2 ? add(add(p >> 2, c >> 2), c >> 1)
            : c;
        }
        const rp = larToRp(larp);
        for (let k = segs[s][0]; k <= segs[s][1]; k++) {
          let sri = wt[k];
          for (let i = 7; i >= 0; i--) {
            const t1 = rp[i];
            const t2 = mult(t1, v[i]);
            sri = sub(sri, t2);
            v[i + 1] = add(v[i], multR(t1, sri));
          }
          v[0] = sri;
          msr = add(sri, multR(msr, 28180));
          out[o + k] = add(msr, msr) & ~7;
        }
      }
      prevLARpp.set(curLARpp);
    };
  }

  // Returns a PCM WAV ArrayBuffer, or null if the buffer isn't a GSM-in-WAV file.
  function toPcmWav(buf) {
    const dv = new DataView(buf);
    const bytes = new Uint8Array(buf);
    const tag = (o) => String.fromCharCode(...bytes.subarray(o, o + 4));
    if (buf.byteLength < 44 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
    let pos = 12, fmt = null, data = null;
    while (pos + 8 <= buf.byteLength) {
      const id = tag(pos), size = dv.getUint32(pos + 4, true);
      if (id === 'fmt ') fmt = { format: dv.getUint16(pos + 8, true), rate: dv.getUint32(pos + 12, true), align: dv.getUint16(pos + 20, true) };
      else if (id === 'data') { data = { start: pos + 8, end: Math.min(buf.byteLength, pos + 8 + size) }; break; }
      pos += 8 + size + (size & 1);
    }
    if (!fmt || !data || fmt.format !== 49) return null;
    const align = fmt.align || 65;
    const decode = createDecoder();
    const blocks = Math.floor((data.end - data.start) / align);
    const pcm = new Int16Array(blocks * 320);
    for (let b = 0; b < blocks; b++) {
      let bit = (data.start + b * align) * 8;
      const br = (n) => {
        let val = 0;
        for (let i = 0; i < n; i++, bit++) val |= ((bytes[bit >> 3] >> (bit & 7)) & 1) << i;
        return val;
      };
      decode(readFrame(br), pcm, b * 320);
      decode(readFrame(br), pcm, b * 320 + 160);
    }
    const out = new ArrayBuffer(44 + pcm.length * 2);
    const ov = new DataView(out);
    const w = (o, s) => [...s].forEach((c, i) => ov.setUint8(o + i, c.charCodeAt(0)));
    w(0, 'RIFF'); ov.setUint32(4, 36 + pcm.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
    ov.setUint32(16, 16, true); ov.setUint16(20, 1, true); ov.setUint16(22, 1, true);
    ov.setUint32(24, fmt.rate, true); ov.setUint32(28, fmt.rate * 2, true);
    ov.setUint16(32, 2, true); ov.setUint16(34, 16, true);
    w(36, 'data'); ov.setUint32(40, pcm.length * 2, true);
    new Int16Array(out, 44).set(pcm);
    return out;
  }

  return { toPcmWav, createDecoder, readFrame };
})();
