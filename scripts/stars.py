# Packs the naked-eye (V <= 6.5) stars of the Yale Bright Star Catalogue (CDS V/50, public domain) into public/stars.bin.
# Per star, 8 bytes little-endian: int16 x,y,z = J2000 unit direction * 32767 (three.js axes: y = celestial north),
# uint8 (Vmag + 2) * 25, uint8 (B-V + 0.5) * 40. Stars without coordinates or B-V are skipped, not guessed.
# usage: python3 -I scripts/stars.py <path to catalog.gz>
import gzip, math, struct, sys

out, kept, skipped = bytearray(), 0, 0
for line in gzip.open(sys.argv[1], 'rt', encoding='ascii'):
    ra_h, vmag, bv = line[75:77].strip(), line[102:107].strip(), line[109:114].strip()
    if not ra_h or not vmag or not bv or float(vmag) > 6.5:
        skipped += 1
        continue
    ra = (int(ra_h) + int(line[77:79]) / 60 + float(line[79:83]) / 3600) * 15 * math.pi / 180
    dec = (int(line[84:86]) + int(line[86:88]) / 60 + int(line[88:90]) / 3600) * (-1 if line[83] == '-' else 1) * math.pi / 180
    x, y, z = math.cos(dec) * math.cos(ra), math.sin(dec), -math.cos(dec) * math.sin(ra)
    m = round((float(vmag) + 2) * 25)
    c = round((float(bv) + 0.5) * 40)
    assert 0 <= m <= 255 and 0 <= c <= 255, (vmag, bv)
    out += struct.pack('<hhhBB', round(x * 32767), round(y * 32767), round(z * 32767), m, c)
    kept += 1
open('public/stars.bin', 'wb').write(out)
print(f'kept {kept}, skipped {skipped}, {len(out)} bytes')
