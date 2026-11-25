import { describe, expect, it } from 'vitest';
import { DRIVE_CHUNK, driveChunks, parseByteRange } from '@/lib/google/drive';
import { CHUNK_SIZE, chunkOffset, chunksTotal, expectedChunkLength, safeFileName } from '@/lib/uploads';

const MiB = 1024 * 1024;
describe('upload chunk maths', () => {
  it('counts chunks', () => {
    expect(CHUNK_SIZE).toBe(4 * MiB);
    expect(chunksTotal(1)).toBe(1);
    expect(chunksTotal(4 * MiB)).toBe(1);
    expect(chunksTotal(4 * MiB + 1)).toBe(2);
    expect(chunksTotal(30 * MiB)).toBe(8);
  });
  it('knows the last chunk length and offsets', () => {
    const size = 10 * MiB + 123;
    expect(expectedChunkLength(0, size)).toBe(4 * MiB);
    expect(expectedChunkLength(2, size)).toBe(2 * MiB + 123);
    expect(expectedChunkLength(3, size)).toBe(-1);
    expect(chunkOffset(2)).toBe(8 * MiB);
  });
  it('sanitises file names', () => {
    expect(safeFileName('../../etc/passwd')).toBe('passwd');
    expect(safeFileName('C:\\Users\\me\\IMG 001.HEIC')).toBe('IMG 001.HEIC');
    expect(safeFileName('a'.repeat(200) + '.mp4')).toHaveLength(120);
    expect(safeFileName('a'.repeat(200) + '.mp4').endsWith('.mp4')).toBe(true);
  });
});

describe('Drive resumable chunking', () => {
  it('every non-final chunk is a multiple of 256 KiB', () => {
    const size = 50 * MiB + 77;
    const ch = driveChunks(size);
    expect(DRIVE_CHUNK % (256 * 1024)).toBe(0);
    ch.slice(0, -1).forEach((c) => expect((c.end - c.start + 1) % (256 * 1024)).toBe(0));
    expect(ch[ch.length - 1].end).toBe(size - 1);
    expect(() => driveChunks(10, 1000)).toThrow();
  });
  it('parses Range headers', () => {
    expect(parseByteRange('bytes=0-99', 1000)).toEqual({ start: 0, end: 99 });
    expect(parseByteRange('bytes=900-', 1000)).toEqual({ start: 900, end: 999 });
    expect(parseByteRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 });
    expect(parseByteRange('bytes=2000-', 1000)).toBeNull();
  });
});
