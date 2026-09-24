// Lossless separable finite differences on each RGBA channel. Smooth 3D
// fields otherwise compress poorly as interleaved raw bytes. All arithmetic
// is modulo 256 through Uint8Array stores; decoding restores exact bytes.
export const CLOUD_NOISE_ENCODING = "rgba8-difference3d-v1";

export function encodeCloudNoise(bytes, n) {
  if (bytes.length !== n ** 3 * 4) throw new RangeError("Invalid cloud-noise dimensions");
  const out = new Uint8Array(bytes), row = n * 4, slice = row * n;
  for (let start = 0; start < out.length; start += row) {
    for (let i = start + row - 1; i >= start + 4; i--) out[i] -= out[i - 4];
  }
  for (let start = 0; start < out.length; start += slice) {
    for (let i = start + slice - 1; i >= start + row; i--) out[i] -= out[i - row];
  }
  for (let i = out.length - 1; i >= slice; i--) out[i] -= out[i - slice];
  return out;
}

// In place: no second 72 MiB decoded buffer for the Ultra volume.
export function decodeCloudNoise(bytes, n) {
  if (bytes.length !== n ** 3 * 4) throw new RangeError("Invalid cloud-noise dimensions");
  const row = n * 4, slice = row * n;
  for (let i = slice; i < bytes.length; i++) bytes[i] += bytes[i - slice];
  for (let start = 0; start < bytes.length; start += slice) {
    for (let i = start + row; i < start + slice; i++) bytes[i] += bytes[i - row];
  }
  for (let start = 0; start < bytes.length; start += row) {
    for (let i = start + 4; i < start + row; i++) bytes[i] += bytes[i - 4];
  }
  return bytes;
}
