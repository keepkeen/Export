#!/usr/bin/env python3
"""Generate polished gradient icons for ChronoChat Studio."""
import math
import pathlib
import struct
import zlib

SIZES = (16, 32, 48, 128)
BG_START = (0x10, 0x1f, 0x36)
BG_END = (0x39, 0xb7, 0xad)
RING_COLOR = (0x6f, 0xf2, 0xd4)
LETTER_COLOR = (0xf5, 0xfc, 0xff)
SHADOW_COLOR = (8, 12, 23)


def lerp(a, b, t):
    return a + (b - a) * t


def mix(color, target, amount):
    return tuple(min(255, max(0, int(round(lerp(c, t, amount))))) for c, t in zip(color, target))


def make_png(size):
    width = height = size
    raw = bytearray()
    cx = (width - 1) / 2
    cy = (height - 1) / 2
    max_radius = min(width, height) * 0.46
    for y in range(height):
        raw.append(0)
        for x in range(width):
            nx = (x + 0.5) / width
            ny = (y + 0.5) / height
            grad_t = (x + y) / (2 * max(1, width - 1))
            base = tuple(int(round(lerp(s, e, grad_t))) for s, e in zip(BG_START, BG_END))
            color = list(base)

            # Subtle vignette shadow.
            vx = (x - cx) / max_radius
            vy = (y - cy) / max_radius
            dist = math.sqrt(vx * vx + vy * vy)
            if dist > 1:
                color = list(mix(color, SHADOW_COLOR, min(0.6, (dist - 1) * 0.5)))

            # Halo ring.
            ring_band = abs(dist - 0.7)
            if ring_band < 0.08:
                ring_mix = max(0, 0.22 - ring_band * 1.8)
                color = list(mix(color, RING_COLOR, ring_mix))

            # Letters CE using simple geometric masks.
            if in_letter_ce(nx, ny):
                color = list(mix(color, LETTER_COLOR, 0.82))

            raw.extend(color + [255])
    ihdr = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)
    compressed = zlib.compress(bytes(raw), 9)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) + chunk(b'IDAT', compressed) + chunk(b'IEND', b'')


def in_letter_ce(nx, ny):
    # Letter C on the left
    if 0.18 <= nx <= 0.34 and 0.26 <= ny <= 0.74:
        return True
    if 0.18 <= nx <= 0.6 and (0.26 <= ny <= 0.34 or 0.66 <= ny <= 0.74):
        return True
    # carve inner gap for the C
    if 0.28 <= nx <= 0.5 and 0.36 <= ny <= 0.64:
        return False
    # Letter E on the right
    if 0.62 <= nx <= 0.7 and 0.26 <= ny <= 0.74:
        return True
    if 0.7 <= nx <= 0.88 and (0.26 <= ny <= 0.34 or 0.48 <= ny <= 0.56 or 0.66 <= ny <= 0.74):
        return True
    if 0.72 <= nx <= 0.84 and 0.36 <= ny <= 0.44:
        return False
    if 0.72 <= nx <= 0.84 and 0.58 <= ny <= 0.64:
        return False
    return False


def chunk(tag, data):
    crc = zlib.crc32(tag + data) & 0xFFFFFFFF
    return len(data).to_bytes(4, 'big') + tag + data + crc.to_bytes(4, 'big')


def main():
    root = pathlib.Path(__file__).resolve().parents[1]
    out_dir = root / 'icons'
    out_dir.mkdir(exist_ok=True)
    for size in SIZES:
        icon_path = out_dir / f'icon-{size}.png'
        icon_path.write_bytes(make_png(size))
        print(f'Wrote {icon_path}')


if __name__ == '__main__':
    main()
