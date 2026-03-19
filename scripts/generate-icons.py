#!/usr/bin/env python3
"""Generate ThreadAtlas icons with a thread-and-atlas motif."""
import math
import pathlib
import struct
import zlib

SIZES = (16, 32, 48, 128)
BG_TOP = (0x08, 0x12, 0x20)
BG_BOTTOM = (0x12, 0x2a, 0x40)
ACCENT = (0x22, 0xc8, 0xa0)
ACCENT_2 = (0x67, 0xe8, 0xf9)
HIGHLIGHT = (0xf5, 0xfb, 0xff)
SHADOW = (0x03, 0x08, 0x12)


def lerp(a, b, t):
    return a + (b - a) * t


def mix(color, target, amount):
    return tuple(min(255, max(0, int(round(lerp(c, t, amount))))) for c, t in zip(color, target))


def smoothstep(edge0, edge1, x):
    if edge0 == edge1:
        return 0.0
    t = min(1.0, max(0.0, (x - edge0) / (edge1 - edge0)))
    return t * t * (3.0 - 2.0 * t)


def sd_circle(x, y, cx, cy, radius):
    return math.hypot(x - cx, y - cy) - radius


def sd_segment(px, py, ax, ay, bx, by):
    abx = bx - ax
    aby = by - ay
    apx = px - ax
    apy = py - ay
    denom = abx * abx + aby * aby
    if denom == 0:
        return math.hypot(apx, apy)
    t = max(0.0, min(1.0, (apx * abx + apy * aby) / denom))
    qx = ax + abx * t
    qy = ay + aby * t
    return math.hypot(px - qx, py - qy)


def inside_rounded_rect(x, y, left, top, right, bottom, radius):
    cx = min(max(x, left + radius), right - radius)
    cy = min(max(y, top + radius), bottom - radius)
    dx = x - cx
    dy = y - cy
    return dx * dx + dy * dy <= radius * radius and left <= x <= right and top <= y <= bottom


def add_shape(color, amount, tint):
    if amount <= 0:
        return color
    return list(mix(color, tint, min(1.0, amount)))


def make_png(size):
    width = height = size
    raw = bytearray()
    radius = width * 0.23
    small_mode = size <= 24
    ring_soft = 0.055 if small_mode else 0.04
    orbit_soft = 0.038 if small_mode else 0.026
    thread_soft = 0.04 if small_mode else 0.026
    node_specs = [
        (0.34, 0.24, 0.068 if small_mode else 0.055, HIGHLIGHT, 0.96),
        (0.34, 0.48, 0.062 if small_mode else 0.048, ACCENT_2, 0.92),
        (0.34, 0.76, 0.066 if small_mode else 0.05, ACCENT, 0.94),
        (0.6, 0.34, 0.062 if small_mode else 0.05, ACCENT_2, 0.9),
    ]
    for y in range(height):
        raw.append(0)
        for x in range(width):
            nx = (x + 0.5) / width
            ny = (y + 0.5) / height
            base = tuple(int(round(lerp(s, e, ny))) for s, e in zip(BG_TOP, BG_BOTTOM))
            color = list(base)

            if not inside_rounded_rect(x + 0.5, y + 0.5, 0.0, 0.0, width, height, radius):
                raw.extend((0, 0, 0, 0))
                continue

            vignette = smoothstep(0.56, 1.05, math.hypot(nx - 0.52, ny - 0.48))
            color = add_shape(color, vignette * 0.58, SHADOW)

            glow = 1.0 - smoothstep(0.0, 0.55, math.hypot(nx - 0.72, ny - 0.28))
            color = add_shape(color, glow * 0.24, ACCENT_2)

            ring = abs(sd_circle(nx, ny, 0.46, 0.5, 0.29))
            ring_alpha = 1.0 - smoothstep(0.0, ring_soft, ring)
            if nx > 0.26:
                color = add_shape(color, ring_alpha * 0.65, ACCENT_2)

            orbit = abs(sd_circle(nx, ny, 0.57, 0.5, 0.18))
            orbit_alpha = 1.0 - smoothstep(0.0, orbit_soft, orbit)
            if (not small_mode) and ny < 0.73:
                color = add_shape(color, orbit_alpha * 0.38, HIGHLIGHT)

            thread_alpha = 1.0 - smoothstep(0.0, thread_soft, sd_segment(nx, ny, 0.34, 0.24, 0.34, 0.76))
            color = add_shape(color, thread_alpha * 0.88, HIGHLIGHT)

            branch_alpha = 1.0 - smoothstep(0.0, thread_soft, sd_segment(nx, ny, 0.34, 0.48, 0.6, 0.34))
            color = add_shape(color, branch_alpha * 0.72, ACCENT)

            for cx, cy, radius_n, tint, strength in node_specs:
                node = sd_circle(nx, ny, cx, cy, radius_n)
                node_alpha = 1.0 - smoothstep(0.0, 0.03, node)
                color = add_shape(color, node_alpha * strength, tint)

            spec = 1.0 - smoothstep(0.0, 0.09, math.hypot(nx - 0.29, ny - 0.2))
            color = add_shape(color, spec * 0.2, HIGHLIGHT)

            raw.extend(color + [255])
    ihdr = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)
    compressed = zlib.compress(bytes(raw), 9)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) + chunk(b'IDAT', compressed) + chunk(b'IEND', b'')


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
