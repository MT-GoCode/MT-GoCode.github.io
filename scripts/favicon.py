# Generates public/favicon.svg: an isometric TARDIS, three flat-shaded faces per block.
import math
C, S = math.cos(math.radians(30)), math.sin(math.radians(30))
K, OX, OY = 13, 32, 49  # px per metre, origin on canvas

def p(x, y, z):
    return f"{OX + (x - z) * C * K:.2f},{OY + ((x + z) * S - y) * K:.2f}"

def poly(pts, fill):
    return f'<polygon points="{" ".join(p(*q) for q in pts)}" fill="{fill}"/>'

LEFT, RIGHT, TOP = '#1f4fa3', '#123776', '#4a7bd0'

def block(h, y0, y1, left=LEFT, right=RIGHT, top=TOP):
    return [
        poly([(-h, y0, h), (h, y0, h), (h, y1, h), (-h, y1, h)], left),   # +z face
        poly([(h, y0, h), (h, y0, -h), (h, y1, -h), (h, y1, h)], right),  # +x face
        poly([(-h, y1, h), (h, y1, h), (h, y1, -h), (-h, y1, -h)], top),
    ]

def windows(h):
    out = []
    for a, b in ((-0.5, -0.08), (0.08, 0.5)):
        out.append(poly([(a, 1.62, h + 0.001), (b, 1.62, h + 0.001), (b, 2.0, h + 0.001), (a, 2.0, h + 0.001)], '#fff4d2'))
        out.append(poly([(h + 0.001, 1.62, -a), (h + 0.001, 1.62, -b), (h + 0.001, 2.0, -b), (h + 0.001, 2.0, -a)], '#e9d9b0'))
    return out

def sign(h):
    return [
        poly([(-h, 2.07, h + 0.002), (h, 2.07, h + 0.002), (h, 2.27, h + 0.002), (-h, 2.27, h + 0.002)], '#0b0b10'),
        poly([(h + 0.002, 2.07, h), (h + 0.002, 2.07, -h), (h + 0.002, 2.27, -h), (h + 0.002, 2.27, h)], '#060609'),
    ]

parts = block(0.75, 0, 0.12) + block(0.66, 0.12, 2.29) + windows(0.66) + sign(0.66)
parts += block(0.71, 2.29, 2.4) + block(0.62, 2.4, 2.5) + block(0.12, 2.5, 2.56)
parts += block(0.06, 2.56, 2.76, '#fff2c8', '#f0d48e', '#fffbe8') + block(0.09, 2.76, 2.81)
svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' + ''.join(parts) + '</svg>\n'
open('public/favicon.svg', 'w').write(svg)
