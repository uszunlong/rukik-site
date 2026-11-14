// 实时协议 v1（ARCH §7.1 的正式版；spike v0 已验证形态）。
// 上行：WS 二进制帧 = PCM16LE 16kHz 单声道分片；文本帧 = 控制消息（pause/resume/end）。
// 下行：每个事件带 seq；先落库后广播，断线重连以服务端已落库状态为准（客户端重拉 get 即可）。
export function parseServerEvent(raw) {
    try {
        const obj = JSON.parse(raw);
        if (obj && typeof obj.type === 'string')
            return obj;
        return null;
    }
    catch {
        return null;
    }
}
export function encodeControl(msg) {
    return JSON.stringify(msg);
}
/** 浏览器/适配层音频帧规格：PCM16LE、16kHz、单声道，0.5–1s/帧。 */
export const AUDIO_FRAME = { sampleRate: 16000, channels: 1, encoding: 'pcm16le' };
export function floatToPcm16(samples) {
    const buf = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
        const s = Math.max(-1, Math.min(1, samples[i]));
        buf[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return buf.buffer;
}
/** 把任意采样率的 Float32 音频线性重采样到 16kHz（适配层采集后统一走此函数）。 */
export function downsampleTo16k(samples, inputRate) {
    if (inputRate === AUDIO_FRAME.sampleRate)
        return samples;
    const ratio = inputRate / AUDIO_FRAME.sampleRate;
    const outLen = Math.floor(samples.length / ratio);
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++)
        out[i] = samples[Math.floor(i * ratio)];
    return out;
}
