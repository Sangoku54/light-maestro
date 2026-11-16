import math

# Test different atan2 formulas
positions = [
    (0.2, 0.95), (0.9, 0.95), (0.5, 0.1), (0.1, 0.5),
    (0.9, 0.5), (0.5, 0.5), (0.1, 0.1), (0.9, 0.1),
]

print("Formula: atan2(0.5 - x, y - 0.5)")
for x, y in positions:
    phi = math.atan2(0.5 - x, y - 0.5)
    while phi > math.pi: phi -= 2*math.pi
    while phi <= -math.pi: phi += 2*math.pi
    dx = -math.sin(phi)
    dz = -math.cos(phi)
    print(f"  ({x},{y}) -> phi={phi:.3f} dir=({dx:.2f},{dz:.2f})")
